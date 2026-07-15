import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CONNECTOR_MCP_URL,
  CONNECTOR_RESOURCE_METADATA,
  REMOTE_SERVER_INFO,
  YNAB_APP_ICON_PNG_SHA256,
  YNAB_APP_ICON_SOURCE_URL,
  WORKS_WITH_YNAB_PNG_SHA256,
  WORKS_WITH_YNAB_SOURCE_URL,
  WORKS_WITH_YNAB_SVG_SHA256,
} from "../src/brand-assets.js";
import {
  YnabHandler,
  persistTokensAndAuthorize,
  revokeAllUserGrants,
} from "../src/ynab-handler.js";
import { consentPage, errorPage, finalConsentPage } from "../src/pages.js";
import {
  buildYnabAuthorizeUrl,
  createKvJournal,
  fetchYnabUserId,
  getFreshAccessToken,
  readTokenRecord,
  refreshTokens,
  saveTokenRecord,
  tokenRecordKey,
  undoJournalKey,
} from "../src/ynab-oauth.js";

const DATA_KEY = "test-only-data-encryption-key-with-enough-entropy";
const COOKIE_KEY = "test-only-cookie-signing-key-with-enough-entropy";

class MemoryKV {
  constructor() {
    this.values = new Map();
  }

  async get(key) {
    return this.values.get(key) ?? null;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }
}

class MemoryTransientNamespace {
  constructor() {
    this.records = new Map();
    this.queues = new Map();
  }

  getByName(name) {
    return {
      fetch: (input, init) => this.#enqueue(name, async () => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "PUT" && url.pathname === "/record") {
          this.records.set(name, await request.json());
          return new Response(null, { status: 204 });
        }
        if (request.method === "POST" && url.pathname === "/consume") {
          const record = this.records.get(name);
          this.records.delete(name);
          if (!record) return new Response(null, { status: 404 });
          if (record.expiresAt <= Date.now()) return new Response(null, { status: 410 });
          return Response.json(record.value);
        }
        return new Response(null, { status: 404 });
      }),
    };
  }

  #enqueue(name, task) {
    const queued = (this.queues.get(name) ?? Promise.resolve()).then(task);
    this.queues.set(name, queued.catch(() => {}));
    return queued;
  }
}

function hiddenValue(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  assert.ok(match, `missing hidden input ${name}`);
  return match[1];
}

function formHeaders(origin = CONNECTOR_MCP_URL.replace(/\/mcp$/, "")) {
  return {
    "Content-Type": "application/x-www-form-urlencoded",
    Origin: origin,
  };
}

function sameOriginNavigationHeaders({ origin } = {}) {
  const connectorOrigin = CONNECTOR_MCP_URL.replace(/\/mcp$/, "");
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Dest": "document",
    Referer: `${connectorOrigin}/authorize`,
  };
  if (origin !== undefined) headers.Origin = origin;
  return headers;
}

test("hosted connector separates the requested app icon from the permitted page mark", async () => {
  assert.equal(
    YNAB_APP_ICON_SOURCE_URL,
    "https://is1-ssl.mzstatic.com/image/thumb/Purple221/v4/71/e6/94/71e694ee-3cf3-44f9-bdcd-d399806ed040/AppIcon-0-0-1x_U007epad-0-1-sRGB-85-220.png/1024x1024bb.png"
  );
  assert.equal(YNAB_APP_ICON_PNG_SHA256, "b1b3180d79d59548fea1ddff1b58622ce66c3ffd1951d416ab4f5d9b63324e0a");
  assert.equal(WORKS_WITH_YNAB_SOURCE_URL, "https://api.ynab.com/papi/works_with_ynab.svg");
  assert.deepEqual(CONNECTOR_RESOURCE_METADATA, {
    resource: CONNECTOR_MCP_URL,
    authorization_servers: ["https://ynab.amesvt.com"],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "MCP Server for YNAB",
  });
  assert.deepEqual(REMOTE_SERVER_INFO.icons, [
    {
      src: "https://ynab.amesvt.com/assets/ynab-app-icon.png",
      mimeType: "image/png",
      sizes: ["1024x1024"],
    },
  ]);

  const assets = [
    ["/assets/works-with-ynab.png", "image/png", WORKS_WITH_YNAB_PNG_SHA256],
    ["/assets/works-with-ynab.svg", "image/svg+xml", WORKS_WITH_YNAB_SVG_SHA256],
    ["/assets/ynab-app-icon.png", "image/png", YNAB_APP_ICON_PNG_SHA256],
    ["/favicon.ico", "image/png", YNAB_APP_ICON_PNG_SHA256],
    ["/favicon.png", "image/png", YNAB_APP_ICON_PNG_SHA256],
  ];
  for (const [path, contentType, expectedSha256] of assets) {
    const response = await YnabHandler.request(`https://ynab.amesvt.com${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", new RegExp(`^${contentType.replace("+", "\\+")}(?:;|$)`));
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(body).digest("hex"), expectedSha256);

    const conditional = await YnabHandler.request(`https://ynab.amesvt.com${path}`, {
      headers: { "If-None-Match": response.headers.get("etag") },
    });
    assert.equal(conditional.status, 304);
    assert.equal((await conditional.arrayBuffer()).byteLength, 0);
  }
});

test("landing page advertises the connector icon", async () => {
  const response = await YnabHandler.request("https://ynab.amesvt.com/");
  const body = await response.text();
  assert.match(body, /<link rel="icon" type="image\/png" sizes="1024x1024" href="\/assets\/ynab-app-icon\.png">/);
  assert.doesNotMatch(body, /rel="icon"[^>]+favicon\.svg/);
  assert.match(body, /<meta property="og:image" content="https:\/\/ynab\.amesvt\.com\/assets\/ynab-app-icon\.png">/);
  assert.match(body, /<meta property="og:image:width" content="1024">/);
  assert.match(body, /<meta property="og:image:height" content="1024">/);
  assert.match(body, /<img class="brand" src="\/assets\/works-with-ynab\.svg"/);
  assert.match(response.headers.get("content-security-policy") ?? "", /img-src 'self'/);
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
});

test("MCP initialization exposes the connector name and icons", async () => {
  process.env.YNAB_MCP_NO_AUTOSTART = "1";
  process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
  const [{ createYnabServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import("../../index.js"),
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/inMemory.js"),
  ]);
  const { server } = createYnabServer({
    hasCredentials: false,
    writesEnabled: false,
    serverInfo: REMOTE_SERVER_INFO,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "worker-metadata-test", version: "1.0.0" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    assert.deepEqual(client.getServerVersion(), REMOTE_SERVER_INFO);
  } finally {
    await client.close();
    await server.close();
  }
});

test("consent and error pages escape untrusted content", () => {
  const html = consentPage({
    clientName: '<img src=x onerror="alert(1)">',
    redirectUri: 'https://client.example/callback?x="><script>alert(2)</script>',
    consentId: 'request"><script>alert(3)</script>',
    csrfToken: 'csrf"><script>alert(4)</script>',
  });

  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.doesNotMatch(errorPage('<script>alert("error")</script>'), /<script>alert/);

  const finalHtml = finalConsentPage({
    clientName: '<img src=x onerror="alert(5)">',
    redirectUri: 'https://client.example/"><script>alert(6)</script>',
    writesEnabled: true,
    purpose: "authorize",
    finalId: 'final"><script>alert(7)</script>',
    csrfToken: 'csrf"><script>alert(8)</script>',
  });
  assert.doesNotMatch(finalHtml, /<script>alert|<img src=x/);
  assert.match(finalHtml, /Read and write access/);
});

test("authorize URL uses YNAB PKCE S256 and minimum read-only scope", () => {
  const url = new URL(buildYnabAuthorizeUrl({
    clientId: "client-id",
    redirectUri: "https://ynab.amesvt.com/callback",
    state: "state",
    codeChallenge: "challenge",
    readOnly: true,
  }));

  assert.equal(url.origin, "https://app.ynab.com");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "read-only");
});

test("token records and undo journals are application-encrypted in KV", async () => {
  const kv = new MemoryKV();
  const record = {
    accessToken: "access-token-should-not-be-plaintext",
    refreshToken: "refresh-token-should-not-be-plaintext",
    expiresAt: 123456,
  };

  await saveTokenRecord(kv, "user-1", record, DATA_KEY);
  const rawToken = await kv.get(tokenRecordKey("user-1"));
  assert.doesNotMatch(rawToken, /access-token|refresh-token/);
  assert.deepEqual(await readTokenRecord(kv, "user-1", DATA_KEY), record);

  const journal = createKvJournal({ OAUTH_KV: kv, DATA_ENCRYPTION_KEY: DATA_KEY }, "user-1");
  const entries = [{ id: "transaction-secret-id", amount: -12.34 }];
  await journal.persist(entries);
  const rawJournal = await kv.get(undoJournalKey("user-1"));
  assert.doesNotMatch(rawJournal, /transaction-secret-id|-12\.34/);
  assert.deepEqual(await journal.read(), entries);
});

test("legacy plaintext token records migrate to encrypted storage on read", async () => {
  const kv = new MemoryKV();
  const record = { accessToken: "legacy-token", refreshToken: "legacy-refresh", expiresAt: 999 };
  await kv.put(tokenRecordKey("legacy-user"), JSON.stringify(record));

  assert.deepEqual(await readTokenRecord(kv, "legacy-user", DATA_KEY), record);
  assert.doesNotMatch(await kv.get(tokenRecordKey("legacy-user")), /legacy-token|legacy-refresh/);
});

test("refresh failure preserves and uses a token refreshed concurrently", async (t) => {
  const kv = new MemoryKV();
  const oldRecord = { accessToken: "expired", refreshToken: "old-refresh", expiresAt: 1 };
  const newRecord = { accessToken: "fresh-from-peer", refreshToken: "new-refresh", expiresAt: Date.now() + 3600000 };
  await saveTokenRecord(kv, "user-1", oldRecord, DATA_KEY);

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => {
    await saveTokenRecord(kv, "user-1", newRecord, DATA_KEY);
    return new Response("{}", { status: 400 });
  };

  const token = await getFreshAccessToken({
    OAUTH_KV: kv,
    DATA_ENCRYPTION_KEY: DATA_KEY,
    YNAB_CLIENT_ID: "client",
    YNAB_CLIENT_SECRET: "secret",
  }, "user-1");
  assert.equal(token, "fresh-from-peer");
  assert.deepEqual(await readTokenRecord(kv, "user-1", DATA_KEY), newRecord);
});

test("YNAB user lookup rejects a successful response without a user id", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, "error");
    return Response.json({ data: { user: {} } });
  };
  await assert.rejects(fetchYnabUserId("token"), /missing a user id/i);
});

test("refresh keeps the prior rotating token when YNAB omits a replacement", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, "error");
    return Response.json({ access_token: "new-access", expires_in: 7200 });
  };

  const refreshed = await refreshTokens({
    YNAB_CLIENT_ID: "client",
    YNAB_CLIENT_SECRET: "secret",
  }, "existing-refresh");
  assert.equal(refreshed.accessToken, "new-access");
  assert.equal(refreshed.refreshToken, "existing-refresh");
});

test("all connector grants are revoked across pagination", async () => {
  const revoked = [];
  const oauth = {
    async listUserGrants(_userId, { cursor } = {}) {
      return cursor
        ? { items: [{ id: "grant-3" }] }
        : { items: [{ id: "grant-1" }, { id: "grant-2" }], cursor: "next" };
    },
    async revokeGrant(id, userId) {
      revoked.push([id, userId]);
    },
  };

  await revokeAllUserGrants(oauth, "user-1");
  assert.deepEqual(revoked, [
    ["grant-1", "user-1"],
    ["grant-2", "user-1"],
    ["grant-3", "user-1"],
  ]);
});

test("failed connector authorization restores the prior encrypted token record", async () => {
  const kv = new MemoryKV();
  const previous = { accessToken: "previous", refreshToken: "previous-refresh", expiresAt: 123 };
  await saveTokenRecord(kv, "user-1", previous, DATA_KEY);
  const previousRaw = await kv.get(tokenRecordKey("user-1"));

  await assert.rejects(persistTokensAndAuthorize({
    OAUTH_KV: kv,
    DATA_ENCRYPTION_KEY: DATA_KEY,
    OAUTH_PROVIDER: {
      async completeAuthorization() { throw new Error("provider failed"); },
    },
  }, {
    record: { oauthReqInfo: { clientId: "client" }, writesEnabled: false },
    tokens: { accessToken: "new", refreshToken: "new-refresh", expiresAt: 456 },
    ynabUserId: "user-1",
  }), /provider failed/);

  assert.equal(await kv.get(tokenRecordKey("user-1")), previousRaw);
  assert.deepEqual(await readTokenRecord(kv, "user-1", DATA_KEY), previous);
});

test("failed connector authorization does not overwrite a concurrent token update", async () => {
  const kv = new MemoryKV();
  const concurrent = { accessToken: "concurrent", refreshToken: "concurrent-refresh", expiresAt: 999 };

  await assert.rejects(persistTokensAndAuthorize({
    OAUTH_KV: kv,
    DATA_ENCRYPTION_KEY: DATA_KEY,
    OAUTH_PROVIDER: {
      async completeAuthorization() {
        await saveTokenRecord(kv, "user-1", concurrent, DATA_KEY);
        throw new Error("provider failed after concurrent update");
      },
    },
  }, {
    record: { oauthReqInfo: { clientId: "client" }, writesEnabled: true },
    tokens: { accessToken: "new", refreshToken: "new-refresh", expiresAt: 456 },
    ynabUserId: "user-1",
  }), /provider failed after concurrent update/);

  assert.deepEqual(await readTokenRecord(kv, "user-1", DATA_KEY), concurrent);
});

test("consent request is opaque, single-use, and redirects to YNAB", async () => {
  const kv = new MemoryKV();
  const transient = new MemoryTransientNamespace();
  const oauthReqInfo = {
    responseType: "code",
    clientId: "registered-client",
    redirectUri: "https://client.example/callback",
    scope: [],
    state: "client-state",
    codeChallenge: "client-pkce",
    codeChallengeMethod: "S256",
    resource: "https://ynab.amesvt.com/mcp",
  };
  const env = {
    COOKIE_ENCRYPTION_KEY: COOKIE_KEY,
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    YNAB_CLIENT_ID: "ynab-client-id",
    OAUTH_KV: kv,
    OAUTH_STATE: transient,
    OAUTH_PROVIDER: {
      async parseAuthRequest() { return oauthReqInfo; },
      async lookupClient() {
        return {
          clientName: '<svg onload="alert(1)">',
          redirectUris: [oauthReqInfo.redirectUri],
        };
      },
    },
  };

  const getResponse = await YnabHandler.request("https://untrusted-preview.example/authorize", {}, env);
  assert.equal(getResponse.status, 200);
  assert.match(getResponse.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  const body = await getResponse.text();
  assert.doesNotMatch(body, /<svg onload/);
  assert.doesNotMatch(body, /client-pkce/);

  const consentId = hiddenValue(body, "consent");
  const csrf = hiddenValue(body, "csrf");
  assert.equal(getResponse.headers.get("set-cookie"), null);
  assert.ok(transient.records.has(`consent:${consentId}`));

  const postResponse = await YnabHandler.request("https://untrusted-preview.example/authorize", {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({ consent: consentId, csrf }),
  }, env);

  assert.equal(postResponse.status, 302);
  const location = new URL(postResponse.headers.get("location"));
  assert.equal(location.origin, "https://app.ynab.com");
  assert.equal(location.searchParams.get("scope"), "read-only");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(location.searchParams.get("redirect_uri"), "https://ynab.amesvt.com/callback");
  assert.equal(transient.records.has(`consent:${consentId}`), false);

  const replay = await YnabHandler.request("https://untrusted-preview.example/authorize", {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({ consent: consentId, csrf }),
  }, env);
  assert.equal(replay.status, 400);
  assert.match(await replay.text(), /Authorization request expired/);
});

test("server-side consent tokens reject tamper and cross-consent without cookies", async () => {
  const kv = new MemoryKV();
  let requestNumber = 0;
  const env = {
    COOKIE_ENCRYPTION_KEY: COOKIE_KEY,
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    YNAB_CLIENT_ID: "ynab-client-id",
    OAUTH_KV: kv,
    OAUTH_STATE: new MemoryTransientNamespace(),
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        requestNumber += 1;
        return {
          responseType: "code",
          clientId: `registered-client-${requestNumber}`,
          redirectUri: `https://client-${requestNumber}.example/callback`,
          scope: [],
          state: `client-state-${requestNumber}`,
          codeChallenge: `client-pkce-${requestNumber}`,
          codeChallengeMethod: "S256",
          resource: CONNECTOR_MCP_URL,
        };
      },
      async lookupClient(clientId) {
        return { clientName: clientId };
      },
    },
  };

  const origin = CONNECTOR_MCP_URL.replace(/\/mcp$/, "");
  const bodies = [];
  for (let i = 0; i < 3; i += 1) {
    const response = await YnabHandler.request(`${origin}/authorize`, {}, env);
    assert.equal(response.headers.get("set-cookie"), null);
    bodies.push(await response.text());
  }

  const crossConsent = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({
      consent: hiddenValue(bodies[1], "consent"),
      csrf: hiddenValue(bodies[0], "csrf"),
    }),
  }, env);
  assert.equal(crossConsent.status, 400);
  assert.match(await crossConsent.text(), /Consent form expired or invalid/);

  const firstValid = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({
      consent: hiddenValue(bodies[0], "consent"),
      csrf: hiddenValue(bodies[0], "csrf"),
    }),
  }, env);
  assert.equal(firstValid.status, 302);

  const thirdConsent = hiddenValue(bodies[2], "consent");
  const thirdCsrf = hiddenValue(bodies[2], "csrf");
  const tampered = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({ consent: thirdConsent, csrf: `${thirdCsrf}x` }),
  }, env);
  assert.equal(tampered.status, 400);
  assert.match(await tampered.text(), /Consent form expired or invalid/);

  const correctAfterTamper = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({ consent: thirdConsent, csrf: thirdCsrf }),
  }, env);
  assert.equal(correctAfterTamper.status, 400);
  assert.match(await correctAfterTamper.text(), /Authorization request expired/);
});

test("authorization forms require the configured same origin without consuming consent", async () => {
  const kv = new MemoryKV();
  const state = new MemoryTransientNamespace();
  const env = {
    COOKIE_ENCRYPTION_KEY: COOKIE_KEY,
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    YNAB_CLIENT_ID: "ynab-client-id",
    OAUTH_KV: kv,
    OAUTH_STATE: state,
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        return {
          responseType: "code",
          clientId: "registered-client",
          redirectUri: "https://client.example/callback",
          scope: [],
          state: "client-state",
          codeChallenge: "client-pkce",
          codeChallengeMethod: "S256",
          resource: CONNECTOR_MCP_URL,
        };
      },
      async lookupClient() { return { clientName: "Trusted MCP Client" }; },
    },
  };
  const origin = CONNECTOR_MCP_URL.replace(/\/mcp$/, "");
  const page = await YnabHandler.request(`${origin}/authorize`, {}, env);
  const body = await page.text();
  const consent = hiddenValue(body, "consent");
  const csrf = hiddenValue(body, "csrf");

  const crossOrigin = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: formHeaders("https://attacker.example"),
    body: new URLSearchParams({ consent, csrf, writes: "1" }),
  }, env);
  assert.equal(crossOrigin.status, 403);
  assert.match(await crossOrigin.text(), /same connector origin/i);

  const forgedOrigin = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: sameOriginNavigationHeaders({ origin: "https://attacker.example" }),
    body: new URLSearchParams({ consent, csrf, writes: "1" }),
  }, env);
  assert.equal(forgedOrigin.status, 403);

  const crossSiteWithoutOrigin = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: {
      ...sameOriginNavigationHeaders(),
      "Sec-Fetch-Site": "cross-site",
      Referer: "https://attacker.example/",
    },
    body: new URLSearchParams({ consent, csrf, writes: "1" }),
  }, env);
  assert.equal(crossSiteWithoutOrigin.status, 403);

  const opaqueSiteWithoutOrigin = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: {
      ...sameOriginNavigationHeaders(),
      "Sec-Fetch-Site": "none",
    },
    body: new URLSearchParams({ consent, csrf, writes: "1" }),
  }, env);
  assert.equal(opaqueSiteWithoutOrigin.status, 403);

  const nonNavigationWithoutOrigin = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: {
      ...sameOriginNavigationHeaders(),
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Dest": "empty",
    },
    body: new URLSearchParams({ consent, csrf, writes: "1" }),
  }, env);
  assert.equal(nonNavigationWithoutOrigin.status, 403);

  const legitimate = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: sameOriginNavigationHeaders(),
    body: new URLSearchParams({ consent, csrf }),
  }, env);
  assert.equal(legitimate.status, 302);
  assert.equal(new URL(legitimate.headers.get("location")).searchParams.get("scope"), "read-only");
});

test("atomic transient state allows only one concurrent consent and callback", async () => {
  const kv = new MemoryKV();
  const state = new MemoryTransientNamespace();
  const env = {
    COOKIE_ENCRYPTION_KEY: COOKIE_KEY,
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    YNAB_CLIENT_ID: "ynab-client-id",
    OAUTH_KV: kv,
    OAUTH_STATE: state,
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        return {
          responseType: "code",
          clientId: "registered-client",
          redirectUri: "https://client.example/callback",
          scope: [],
          state: "client-state",
          codeChallenge: "client-pkce",
          codeChallengeMethod: "S256",
          resource: CONNECTOR_MCP_URL,
        };
      },
      async lookupClient() { return { clientName: "Concurrent Client" }; },
    },
  };
  const origin = CONNECTOR_MCP_URL.replace(/\/mcp$/, "");
  const page = await YnabHandler.request(`${origin}/authorize`, {}, env);
  const body = await page.text();
  const form = new URLSearchParams({
    consent: hiddenValue(body, "consent"),
    csrf: hiddenValue(body, "csrf"),
  });
  const approvals = await Promise.all([1, 2].map(() => YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams(form),
  }, env)));
  assert.deepEqual(approvals.map((response) => response.status).sort(), [302, 400]);
  const approved = approvals.find((response) => response.status === 302);
  const oauthState = new URL(approved.headers.get("location")).searchParams.get("state");

  const callbacks = await Promise.all([1, 2].map(() => YnabHandler.request(
    `${origin}/callback?error=access_denied&state=${encodeURIComponent(oauthState)}`,
    {},
    env
  )));
  const callbackBodies = await Promise.all(callbacks.map((response) => response.text()));
  assert.equal(callbackBodies.filter((text) => text.includes("YNAB did not authorize the connector")).length, 1);
  assert.equal(callbackBodies.filter((text) => text.includes("Authorization state expired or did not match")).length, 1);
});

test("YNAB callback requires a final same-origin confirmation before creating a grant", async (t) => {
  const kv = new MemoryKV();
  const transient = new MemoryTransientNamespace();
  let completed = 0;
  const env = {
    COOKIE_ENCRYPTION_KEY: COOKIE_KEY,
    DATA_ENCRYPTION_KEY: DATA_KEY,
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    YNAB_CLIENT_ID: "ynab-client-id",
    YNAB_CLIENT_SECRET: "ynab-client-secret",
    OAUTH_KV: kv,
    OAUTH_STATE: transient,
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        return {
          responseType: "code",
          clientId: "attacker-controlled-client",
          redirectUri: "https://attacker-client.example/callback",
          scope: [],
          state: "client-state",
          codeChallenge: "client-pkce",
          codeChallengeMethod: "S256",
          resource: CONNECTOR_MCP_URL,
        };
      },
      async lookupClient() { return { clientName: "Attacker Controlled Client" }; },
      async completeAuthorization() {
        completed += 1;
        return { redirectTo: "https://attacker-client.example/callback?code=connector-code" };
      },
    },
  };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url) => {
    if (String(url) === "https://app.ynab.com/oauth/token") {
      return Response.json({
        access_token: "pending-access-token",
        refresh_token: "pending-refresh-token",
        expires_in: 7200,
      });
    }
    if (String(url) === "https://api.ynab.com/v1/user") {
      return Response.json({ data: { user: { id: "ynab-user-1" } } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const origin = CONNECTOR_MCP_URL.replace(/\/mcp$/, "");
  const page = await YnabHandler.request(`${origin}/authorize`, {}, env);
  const consentBody = await page.text();
  const approval = await YnabHandler.request(`${origin}/authorize`, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({
      consent: hiddenValue(consentBody, "consent"),
      csrf: hiddenValue(consentBody, "csrf"),
    }),
  }, env);
  const oauthState = new URL(approval.headers.get("location")).searchParams.get("state");

  const callback = await YnabHandler.request(
    `${origin}/callback?code=ynab-code&state=${encodeURIComponent(oauthState)}`,
    {},
    env
  );
  assert.equal(callback.status, 200);
  const callbackBody = await callback.text();
  assert.match(callbackBody, /Attacker Controlled Client/);
  assert.match(callbackBody, /Read-only access/);
  assert.equal(completed, 0);
  assert.equal(await kv.get(tokenRecordKey("ynab-user-1")), null);
  assert.doesNotMatch(JSON.stringify([...transient.records.values()]), /pending-access-token|pending-refresh-token/);

  const finalize = hiddenValue(callbackBody, "finalize");
  const csrf = hiddenValue(callbackBody, "csrf");
  const crossOrigin = await YnabHandler.request(`${origin}/callback`, {
    method: "POST",
    headers: formHeaders("https://attacker.example"),
    body: new URLSearchParams({ finalize, csrf }),
  }, env);
  assert.equal(crossOrigin.status, 403);
  assert.equal(completed, 0);

  const forgedOrigin = await YnabHandler.request(`${origin}/callback`, {
    method: "POST",
    headers: {
      ...sameOriginNavigationHeaders({ origin: "https://attacker.example" }),
      Referer: `${origin}/callback`,
    },
    body: new URLSearchParams({ finalize, csrf }),
  }, env);
  assert.equal(forgedOrigin.status, 403);
  assert.equal(completed, 0);

  const crossSiteWithoutOrigin = await YnabHandler.request(`${origin}/callback`, {
    method: "POST",
    headers: {
      ...sameOriginNavigationHeaders(),
      "Sec-Fetch-Site": "cross-site",
      Referer: "https://attacker.example/",
    },
    body: new URLSearchParams({ finalize, csrf }),
  }, env);
  assert.equal(crossSiteWithoutOrigin.status, 403);
  assert.equal(completed, 0);

  const opaqueSiteWithoutOrigin = await YnabHandler.request(`${origin}/callback`, {
    method: "POST",
    headers: {
      ...sameOriginNavigationHeaders(),
      "Sec-Fetch-Site": "none",
      Referer: `${origin}/callback`,
    },
    body: new URLSearchParams({ finalize, csrf }),
  }, env);
  assert.equal(opaqueSiteWithoutOrigin.status, 403);
  assert.equal(completed, 0);

  const finish = await YnabHandler.request(`${origin}/callback`, {
    method: "POST",
    headers: {
      ...sameOriginNavigationHeaders(),
      Referer: `${origin}/callback`,
    },
    body: new URLSearchParams({ finalize, csrf }),
    redirect: "manual",
  }, env);
  assert.equal(finish.status, 302);
  assert.equal(finish.headers.get("location"), "https://attacker-client.example/callback?code=connector-code");
  assert.equal(completed, 1);
  assert.ok(await kv.get(tokenRecordKey("ynab-user-1")));

  const replay = await YnabHandler.request(`${origin}/callback`, {
    method: "POST",
    headers: formHeaders(),
    body: new URLSearchParams({ finalize, csrf }),
  }, env);
  assert.equal(replay.status, 400);
  assert.match(await replay.text(), /Final confirmation expired or invalid/);
  assert.equal(completed, 1);
});

test("overlapping YNAB approvals validate cookie-free state and reject replay", async () => {
  const kv = new MemoryKV();
  let requestNumber = 0;
  const env = {
    COOKIE_ENCRYPTION_KEY: COOKIE_KEY,
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    YNAB_CLIENT_ID: "ynab-client-id",
    OAUTH_KV: kv,
    OAUTH_STATE: new MemoryTransientNamespace(),
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        requestNumber += 1;
        return {
          responseType: "code",
          clientId: `registered-client-${requestNumber}`,
          redirectUri: `https://client-${requestNumber}.example/callback`,
          scope: [],
          state: `client-state-${requestNumber}`,
          codeChallenge: `client-pkce-${requestNumber}`,
          codeChallengeMethod: "S256",
          resource: CONNECTOR_MCP_URL,
        };
      },
      async lookupClient(clientId) {
        return { clientName: clientId };
      },
    },
  };
  const origin = CONNECTOR_MCP_URL.replace(/\/mcp$/, "");

  const pages = [];
  for (let i = 0; i < 2; i += 1) {
    const response = await YnabHandler.request(`${origin}/authorize`, {}, env);
    pages.push(await response.text());
  }

  const states = [];
  for (const body of pages) {
    const response = await YnabHandler.request(`${origin}/authorize`, {
      method: "POST",
      headers: formHeaders(),
      body: new URLSearchParams({
        consent: hiddenValue(body, "consent"),
        csrf: hiddenValue(body, "csrf"),
      }),
    }, env);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("set-cookie"), null);
    states.push(new URL(response.headers.get("location")).searchParams.get("state"));
  }

  const firstCallback = await YnabHandler.request(
    `${origin}/callback?error=access_denied&state=${encodeURIComponent(states[0])}`,
    {},
    env
  );
  assert.equal(firstCallback.status, 400);
  assert.match(await firstCallback.text(), /YNAB did not authorize the connector/);

  const replay = await YnabHandler.request(
    `${origin}/callback?error=access_denied&state=${encodeURIComponent(states[0])}`,
    {},
    env
  );
  assert.equal(replay.status, 400);
  assert.match(await replay.text(), /Authorization state expired or did not match/);

  const tamperedState = `${states[1].slice(0, -1)}${states[1].endsWith("A") ? "B" : "A"}`;
  const tampered = await YnabHandler.request(
    `${origin}/callback?error=access_denied&state=${encodeURIComponent(tamperedState)}`,
    {},
    env
  );
  assert.equal(tampered.status, 400);
  assert.match(await tampered.text(), /Authorization state expired or did not match/);

  const secondCallback = await YnabHandler.request(
    `${origin}/callback?error=access_denied&state=${encodeURIComponent(states[1])}`,
    {},
    env
  );
  assert.equal(secondCallback.status, 400);
  assert.match(await secondCallback.text(), /YNAB did not authorize the connector/);
});
