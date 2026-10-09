import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CONNECTOR_MCP_URL,
  CONNECTOR_FAVICON_16_PNG_SHA256,
  CONNECTOR_FAVICON_32_PNG_SHA256,
  CONNECTOR_FAVICON_48_PNG_SHA256,
  CONNECTOR_FAVICON_64_PNG_SHA256,
  CONNECTOR_FAVICON_96_PNG_SHA256,
  CONNECTOR_FAVICON_128_PNG_SHA256,
  CONNECTOR_FAVICON_256_PNG_SHA256,
  CONNECTOR_FAVICON_ICO,
  CONNECTOR_FAVICON_ICO_SHA256,
  CONNECTOR_FAVICON_SVG_SHA256,
  CONNECTOR_ICON_PNG_SHA256,
  CONNECTOR_RESOURCE_METADATA,
  REMOTE_SERVER_INFO,
  WORKS_WITH_YNAB_PNG_SHA256,
  WORKS_WITH_YNAB_SOURCE_URL,
  WORKS_WITH_YNAB_SVG_SHA256,
} from "../src/brand-assets.js";
import {
  YnabHandler,
  persistTokensAndAuthorize,
  revokeAllUserGrants,
  deleteUserCredentials,
} from "../src/ynab-handler.js";
import { CredentialStoreCore } from "../src/credential-store-core.js";
import { hostedServerOptions } from "../src/hosted-options.js";
import { withCredentialMcpNamespace } from "../src/mcp-session-isolation.js";
import { allowedMcpOrigins, rejectUntrustedMcpOrigin } from "../src/mcp-origin.js";
import { consentPage, errorPage, finalConsentPage, privacyPage } from "../src/pages.js";
import { applyTransportSecurityHeaders } from "../src/response-security.js";
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
  credentialStoreRequest,
  credentialGeneration,
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
    for (const item of Array.isArray(key) ? key : [key]) this.values.delete(item);
  }

  async deleteAll() {
    this.values.clear();
  }

  async list() {
    return new Map(this.values);
  }

  async transaction(callback) {
    const txn = new MemoryKV();
    txn.values = new Map(this.values);
    const result = await callback(txn);
    this.values = txn.values;
    return result;
  }
}

function testBinding({ user = "user-1", client = "client-1", writes = false, id = "A".repeat(32) } = {}) {
  return { credentialVersion: 2, credentialId: id, ynabUserId: user, clientId: client, writesEnabled: writes };
}

class MemoryCredentialNamespace {
  constructor(env = {}) {
    this.env = { DATA_ENCRYPTION_KEY: DATA_KEY, YNAB_CLIENT_ID: "fake-client", YNAB_CLIENT_SECRET: "fake-secret", ...env };
    this.objects = new Map();
  }

  getByName(name) {
    if (!this.objects.has(name)) {
      const storage = new MemoryKV();
      this.objects.set(name, { storage, core: new CredentialStoreCore(storage, this.env) });
    }
    const { core } = this.objects.get(name);
    return { fetch: (input, init) => core.fetch(new Request(input, init)) };
  }

  storage(user = "user-1") {
    this.getByName(`ynab-user:${encodeURIComponent(user)}`);
    return this.objects.get(`ynab-user:${encodeURIComponent(user)}`).storage;
  }
}

function credentialEnv(extra = {}) {
  return { OAUTH_KV: new MemoryKV(), DATA_ENCRYPTION_KEY: DATA_KEY, YNAB_CREDENTIALS: new MemoryCredentialNamespace(), ...extra };
}

async function storeCredential(env, binding, tokens = { accessToken: "fake-access", refreshToken: "fake-refresh", expiresAt: Date.now() + 7200000 }) {
  const generation = await credentialGeneration(env, binding.ynabUserId);
  const response = await credentialStoreRequest(env, binding.ynabUserId, "/create", { binding, tokens, generation });
  assert.equal(response.status, 204);
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

test("hosted connector uses the exact Codex plugin icon and conventional favicons", async () => {
  const codexIcon = await readFile(new URL("../../codex/assets/icon.png", import.meta.url));
  assert.equal(
    createHash("sha256").update(codexIcon).digest("hex"),
    CONNECTOR_ICON_PNG_SHA256
  );
  assert.equal(WORKS_WITH_YNAB_SOURCE_URL, "https://api.ynab.com/papi/works_with_ynab.svg");
  assert.deepEqual(CONNECTOR_RESOURCE_METADATA, {
    resource: CONNECTOR_MCP_URL,
    authorization_servers: ["https://ynab.amesvt.com"],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "YNAB",
  });
  assert.equal(REMOTE_SERVER_INFO.name, "YNAB");
  assert.equal(REMOTE_SERVER_INFO.title, "YNAB");
  assert.deepEqual(REMOTE_SERVER_INFO.icons, [
    {
      src: "https://ynab.amesvt.com/assets/ynab-tree-icon-v1.png",
      mimeType: "image/png",
      sizes: ["256x256"],
    },
    {
      src: "https://ynab.amesvt.com/assets/icon.png",
      mimeType: "image/png",
      sizes: ["1024x1024"],
    },
  ]);

  const assets = [
    ["/assets/works-with-ynab.png", "image/png", WORKS_WITH_YNAB_PNG_SHA256],
    ["/assets/works-with-ynab.svg", "image/svg+xml", WORKS_WITH_YNAB_SVG_SHA256],
    ["/assets/icon.png", "image/png", CONNECTOR_ICON_PNG_SHA256],
    ["/assets/ynab-app-icon.png", "image/png", CONNECTOR_ICON_PNG_SHA256],
    ["/favicon.ico", "image/x-icon", CONNECTOR_FAVICON_ICO_SHA256],
    ["/favicon.svg", "image/svg+xml", CONNECTOR_FAVICON_SVG_SHA256],
    ["/favicon-16x16.png", "image/png", CONNECTOR_FAVICON_16_PNG_SHA256],
    ["/favicon-32x32.png", "image/png", CONNECTOR_FAVICON_32_PNG_SHA256],
    ["/favicon-48x48.png", "image/png", CONNECTOR_FAVICON_48_PNG_SHA256],
    ["/favicon-64x64.png", "image/png", CONNECTOR_FAVICON_64_PNG_SHA256],
    ["/favicon-96x96.png", "image/png", CONNECTOR_FAVICON_96_PNG_SHA256],
    ["/favicon-128x128.png", "image/png", CONNECTOR_FAVICON_128_PNG_SHA256],
    ["/favicon-256x256.png", "image/png", CONNECTOR_FAVICON_256_PNG_SHA256],
    ["/assets/ynab-tree-icon-v1.png", "image/png", CONNECTOR_FAVICON_256_PNG_SHA256],
  ];
  for (const [path, contentType, expectedSha256] of assets) {
    const response = await YnabHandler.request(`https://ynab.amesvt.com${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", new RegExp(`^${contentType.replace("+", "\\+")}(?:;|$)`));
    assert.equal(
      response.headers.get("cache-control"),
      path === "/favicon.ico" || path === "/favicon.svg"
        ? "public, max-age=0, must-revalidate"
        : "public, max-age=31536000, immutable"
    );
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

test("favicon.ico stays small enough for icon resolvers", () => {
  // A six-frame uncompressed ICO reached 370 KB, which resolvers skipped. The
  // reference that does render in Claude, sosumi.ai, serves one 32x32 frame at
  // 4,286 bytes. Keep a wide margin but fail loudly if the frame list grows
  // back. See WORKLOG 2026-07-30.
  assert.ok(
    CONNECTOR_FAVICON_ICO.length < 10_000,
    `favicon.ico is ${CONNECTOR_FAVICON_ICO.length} bytes; keep it to a single 32x32 frame`,
  );
});

test("landing page advertises the connector icon", async () => {
  const response = await YnabHandler.request("https://ynab.amesvt.com/");
  const body = await response.text();
  // The square tree favicon leads, with a small ICO as the alternate. Icon
  // resolvers take the first usable declaration, so nothing large or ambiguous
  // is advertised ahead of it. See WORKLOG 2026-07-30.
  assert.match(body, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(body, /<link rel="alternate icon" href="\/favicon\.ico" sizes="32x32">/);
  assert.match(body, /<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32x32\.png">/);
  assert.match(body, /<link rel="icon" type="image\/png" sizes="16x16" href="\/favicon-16x16\.png">/);
  // The "Works with YNAB" wordmark is 196x78 and must never be advertised as a
  // favicon; only the square tree artwork may be.
  assert.doesNotMatch(body, /rel="[^"]*icon"[^>]+works-with-ynab/);
  assert.match(body, /<meta property="og:image" content="https:\/\/ynab\.amesvt\.com\/assets\/icon\.png">/);
  assert.match(body, /<meta property="og:image:width" content="1024">/);
  assert.match(body, /<meta property="og:image:height" content="1024">/);
  assert.match(body, /<img class="brand" src="\/assets\/works-with-ynab\.svg"/);
  assert.match(response.headers.get("content-security-policy") ?? "", /img-src 'self'/);
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
});

test("HTML CSP defaults forms to the connector origin", async () => {
  const response = await YnabHandler.request("https://ynab.amesvt.com/");
  const policy = response.headers.get("content-security-policy") ?? "";

  assert.match(policy, /form-action 'self'(?:;|$)/);
});

test("MCP endpoints reject untrusted browser origins before OAuth", async () => {
  const env = {
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    MCP_ALLOWED_ORIGINS: "https://chatgpt.com, https://claude.ai",
  };

  assert.deepEqual(
    allowedMcpOrigins(env),
    new Set(["https://ynab.amesvt.com", "https://chatgpt.com", "https://claude.ai"])
  );
  assert.equal(
    rejectUntrustedMcpOrigin(new Request("https://ynab.amesvt.com/mcp"), env),
    null
  );
  assert.equal(
    rejectUntrustedMcpOrigin(new Request("https://ynab.amesvt.com/mcp", {
      headers: { Origin: "https://chatgpt.com" },
    }), env), null);
  assert.equal(
    rejectUntrustedMcpOrigin(new Request("https://ynab.amesvt.com/privacy", {
      headers: { Origin: "https://example.invalid" },
    }), env), null);

  const response = rejectUntrustedMcpOrigin(new Request("https://ynab.amesvt.com/mcp", {
    method: "POST",
    headers: { Origin: "https://example.invalid" },
  }), env);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Origin");
  assert.deepEqual(await response.json(), {
    error: "invalid_origin",
    error_description: "Browser Origin is not permitted for this MCP endpoint.",
  });
});

test("HTTPS responses carry hostname-scoped HSTS", async () => {
  const secureRequest = new Request("https://ynab.amesvt.com/privacy");
  const secureResponse = applyTransportSecurityHeaders(secureRequest, new Response("ok"));
  assert.equal(secureResponse.headers.get("strict-transport-security"), "max-age=31536000");
  assert.equal(await secureResponse.text(), "ok");

  const insecureRequest = new Request("http://ynab.amesvt.com/privacy");
  const insecureResponse = applyTransportSecurityHeaders(insecureRequest, new Response("ok"));
  assert.equal(insecureResponse.headers.get("strict-transport-security"), null);
});

test("privacy policy states current retention, hosting, and client delivery", () => {
  const html = privacyPage();

  assert.match(html, /Last updated:<\/strong> October 9, 2026/);
  assert.match(html, /Cloudflare hosts the Worker/);
  assert.match(html, /retained until you use/);
  assert.match(html, /expires automatically within 10 minutes/);
  assert.match(html, /returns the result to the MCP client you connected/);
  assert.doesNotMatch(html, /send data to any host other than/);
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

test("consent token records and undo journals are application-encrypted in durable storage", async () => {
  const env = credentialEnv();
  const binding = testBinding();
  const storage = env.YNAB_CREDENTIALS.storage();
  const record = {
    accessToken: "access-token-should-not-be-plaintext",
    refreshToken: "refresh-token-should-not-be-plaintext",
    expiresAt: 123456,
  };

  await storeCredential(env, binding, record);
  const rawToken = await storage.get(tokenRecordKey(binding));
  assert.doesNotMatch(rawToken, /access-token|refresh-token/);
  assert.deepEqual(await readTokenRecord(storage, binding, DATA_KEY), record);

  const journal = createKvJournal(env, binding);
  const entries = [{ id: "transaction-secret-id", amount: -12.34 }];
  await journal.persist(entries);
  const rawJournal = await storage.get(undoJournalKey(binding));
  assert.doesNotMatch(rawJournal, /transaction-secret-id|-12\.34/);
  assert.deepEqual(await journal.read(), entries);
});

test("legacy shared credentials require reauthorization instead of ambiguous migration", async () => {
  const kv = new MemoryKV();
  const record = { accessToken: "legacy-token", refreshToken: "legacy-refresh", expiresAt: 999 };
  await kv.put(tokenRecordKey("legacy-user"), JSON.stringify(record));

  assert.equal(await readTokenRecord(kv, "legacy-user", DATA_KEY), null);
  const options = hostedServerOptions(credentialEnv({ OAUTH_KV: kv }), { ynabUserId: "legacy-user", writesEnabled: true }, "session");
  assert.equal(options.hasCredentials, false);
  assert.equal(options.writesEnabled, false);
  assert.equal(await options.getAccessToken(), null);
  assert.match(options.runtime.tokenLookupError, /Reconnect/);
  assert.match(options.runtime.setupGuide.prompt_for_agent, /Do not request or share a personal access token/);
});

test("concurrent sessions serialize a rotating refresh and preserve its binding", async (t) => {
  const env = credentialEnv();
  const binding = testBinding({ writes: true });
  const storage = env.YNAB_CREDENTIALS.storage();
  const oldRecord = { accessToken: "expired", refreshToken: "old-refresh", expiresAt: 1 };
  await storeCredential(env, binding, oldRecord);

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let refreshCount = 0;
  globalThis.fetch = async (_url, init) => {
    refreshCount += 1;
    assert.equal(new URLSearchParams(init.body).get("refresh_token"), "old-refresh");
    return Response.json({ access_token: "fresh-once", refresh_token: "new-refresh", expires_in: 7200 });
  };
  const results = await Promise.all(Array.from({ length: 8 }, () => getFreshAccessToken(env, binding)));
  assert.deepEqual(results, Array(8).fill("fresh-once"));
  assert.equal(refreshCount, 1);
  assert.equal((await readTokenRecord(storage, binding, DATA_KEY)).refreshToken, "new-refresh");
  assert.equal(await readTokenRecord(storage, { ...binding, writesEnabled: false }, DATA_KEY), null);
});

test("YNAB user lookup rejects a successful response without a user id", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, "manual");
    return Response.json({ data: { user: {} } });
  };
  await assert.rejects(fetchYnabUserId("token"), /missing a user id/i);
});

test("refresh keeps the prior rotating token when YNAB omits a replacement", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.redirect, "manual");
    return Response.json({ access_token: "new-access", expires_in: 7200 });
  };

  const refreshed = await refreshTokens({
    YNAB_CLIENT_ID: "client",
    YNAB_CLIENT_SECRET: "secret",
  }, "existing-refresh");
  assert.equal(refreshed.accessToken, "new-access");
  assert.equal(refreshed.refreshToken, "existing-refresh");
});

test("YNAB requests reject manual redirect responses without following them", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests += 1;
    assert.equal(init.redirect, "manual");
    return new Response(null, {
      status: 302,
      headers: { Location: "https://attacker.example/credential-capture" },
    });
  };

  await assert.rejects(refreshTokens({
    YNAB_CLIENT_ID: "client",
    YNAB_CLIENT_SECRET: "secret",
  }, "refresh-token"), /unexpected redirect/i);
  await assert.rejects(fetchYnabUserId("access-token"), /unexpected redirect/i);
  assert.equal(requests, 2);
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

test("failed connector authorization removes only its new credential", async () => {
  const env = credentialEnv();
  const binding = testBinding({ writes: true });
  const previous = { accessToken: "previous", refreshToken: "previous-refresh", expiresAt: 123 };
  await storeCredential(env, binding, previous);
  const storage = env.YNAB_CREDENTIALS.storage();
  const previousRaw = await storage.get(tokenRecordKey(binding));

  await assert.rejects(persistTokensAndAuthorize({
    ...env,
    OAUTH_PROVIDER: {
      async completeAuthorization() { throw new Error("provider failed"); },
    },
  }, {
    record: { oauthReqInfo: { clientId: "client" }, writesEnabled: false, credentialGeneration: 0 },
    tokens: { accessToken: "new", refreshToken: "new-refresh", expiresAt: 456 },
    ynabUserId: "user-1",
  }), /provider failed/);

  assert.equal(await storage.get(tokenRecordKey(binding)), previousRaw);
  assert.deepEqual(await readTokenRecord(storage, binding, DATA_KEY), previous);
  assert.equal([...storage.values.keys()].filter((key) => key.startsWith("ynab_token:v2:")).length, 1);
});

test("failed connector authorization cannot overwrite a concurrent successful consent", async () => {
  const env = credentialEnv();
  const concurrent = { accessToken: "concurrent", refreshToken: "concurrent-refresh", expiresAt: 999 };
  let concurrentBinding;

  await assert.rejects(persistTokensAndAuthorize({
    ...env,
    OAUTH_PROVIDER: {
      async completeAuthorization() {
        await persistTokensAndAuthorize({ ...env, OAUTH_PROVIDER: {
          async completeAuthorization(args) { concurrentBinding = args.props; return { redirectTo: "https://fake.example/callback" }; },
        } }, { record: { oauthReqInfo: { clientId: "peer-client" }, writesEnabled: false, credentialGeneration: 0 }, tokens: concurrent, ynabUserId: "user-1" });
        throw new Error("provider failed after concurrent update");
      },
    },
  }, {
    record: { oauthReqInfo: { clientId: "client" }, writesEnabled: true, credentialGeneration: 0 },
    tokens: { accessToken: "new", refreshToken: "new-refresh", expiresAt: 456 },
    ynabUserId: "user-1",
  }), /provider failed after concurrent update/);

  assert.deepEqual(await readTokenRecord(env.YNAB_CREDENTIALS.storage(), concurrentBinding, DATA_KEY), concurrent);
  assert.equal([...env.YNAB_CREDENTIALS.storage().values.keys()].filter((key) => key.startsWith("ynab_token:v2:")).length, 1);
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
  assert.match(
    getResponse.headers.get("content-security-policy") ?? "",
    /form-action 'self' https:\/\/app\.ynab\.com(?:;|$)/
  );
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

test("YNAB callback completes through a native client scheme after final confirmation", async (t) => {
  const kv = new MemoryKV();
  const transient = new MemoryTransientNamespace();
  let completed = 0;
  let completedBinding;
  const env = {
    COOKIE_ENCRYPTION_KEY: COOKIE_KEY,
    DATA_ENCRYPTION_KEY: DATA_KEY,
    CONNECTOR_BASE_URL: "https://ynab.amesvt.com",
    YNAB_CLIENT_ID: "ynab-client-id",
    YNAB_CLIENT_SECRET: "ynab-client-secret",
    OAUTH_KV: kv,
    OAUTH_STATE: transient,
    YNAB_CREDENTIALS: new MemoryCredentialNamespace(),
    OAUTH_PROVIDER: {
      async parseAuthRequest() {
        return {
          responseType: "code",
          clientId: "attacker-controlled-client",
          redirectUri: "com.oliverames.amesutilities:/mcp-oauth",
          scope: [],
          state: "client-state",
          codeChallenge: "client-pkce",
          codeChallengeMethod: "S256",
          resource: CONNECTOR_MCP_URL,
        };
      },
      async lookupClient() { return { clientName: "Attacker Controlled Client" }; },
      async completeAuthorization(args) {
        completed += 1;
        completedBinding = args.props;
        return { redirectTo: "com.oliverames.amesutilities:/mcp-oauth?code=connector-code" };
      },
    },
  };
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const upstreamRequests = [];
  globalThis.fetch = async (url, init = {}) => {
    // Simulate the Workers fetch validation that caused the production callback
    // failure: only the platform-supported redirect modes may reach upstream.
    if (init.redirect !== "follow" && init.redirect !== "manual") {
      throw new TypeError(`Invalid redirect value: ${init.redirect}`);
    }
    upstreamRequests.push({ url: String(url), redirect: init.redirect });
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
  assert.match(
    callback.headers.get("content-security-policy") ?? "",
    /form-action 'self' com\.oliverames\.amesutilities:(?:;|$)/
  );
  const callbackBody = await callback.text();
  assert.match(callbackBody, /Attacker Controlled Client/);
  assert.match(callbackBody, /Read-only access/);
  assert.deepEqual(upstreamRequests, [
    { url: "https://app.ynab.com/oauth/token", redirect: "manual" },
    { url: "https://api.ynab.com/v1/user", redirect: "manual" },
  ]);
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
  assert.equal(finish.headers.get("location"), "com.oliverames.amesutilities:/mcp-oauth?code=connector-code");
  assert.equal(completed, 1);
  assert.equal(await kv.get(tokenRecordKey("ynab-user-1")), null);
  assert.ok(await env.YNAB_CREDENTIALS.storage("ynab-user-1").get(tokenRecordKey(completedBinding)));

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

async function approveFakeConsent(env, { user = "user-1", client = "client-1", writes = false, access = "fake-access" } = {}) {
  let binding;
  await persistTokensAndAuthorize({ ...env, OAUTH_PROVIDER: {
    async completeAuthorization(args) {
      binding = args.props;
      assert.deepEqual(args.scope, writes ? ["read", "write"] : ["read"]);
      return { redirectTo: "https://fake-client.example/callback" };
    },
  } }, {
    record: { oauthReqInfo: { clientId: client }, writesEnabled: writes, credentialGeneration: await credentialGeneration(env, user) },
    tokens: { accessToken: access, refreshToken: `refresh-${access}`, expiresAt: Date.now() + 7200000 },
    ynabUserId: user,
  });
  return binding;
}

test("separate clients keep compatible credentials after both scope orders and reconnects", async () => {
  for (const order of [[true, false], [false, true]]) {
    const env = credentialEnv();
    const first = await approveFakeConsent(env, { client: "client-a", writes: order[0], access: "access-a" });
    const second = await approveFakeConsent(env, { client: "client-b", writes: order[1], access: "access-b" });
    const reconnect = await approveFakeConsent(env, { client: "client-a", writes: !order[0], access: "access-a-reconnected" });
    assert.notEqual(first.credentialId, second.credentialId);
    assert.notEqual(first.credentialId, reconnect.credentialId);
    for (const [binding, token] of [[first, "access-a"], [second, "access-b"], [reconnect, "access-a-reconnected"]]) {
      const options = hostedServerOptions(env, binding, "fake-session");
      assert.equal(options.writesEnabled, binding.writesEnabled);
      assert.equal(await options.getAccessToken(), token);
    }
    const firstJournal = createKvJournal(env, first);
    const secondJournal = createKvJournal(env, second);
    await firstJournal.persist([{ id: "fake-operation-a" }]);
    assert.deepEqual(await secondJournal.read(), []);
  }
});

test("credential lookup rejects cross-user, cross-client, and cross-scope bindings", async () => {
  const env = credentialEnv();
  const binding = await approveFakeConsent(env, { writes: true });
  for (const changed of [
    { ...binding, ynabUserId: "user-2" },
    { ...binding, clientId: "client-2" },
    { ...binding, writesEnabled: false },
  ]) {
    await assert.rejects(getFreshAccessToken(env, changed), /Reconnect/);
    await assert.rejects(createKvJournal(env, changed).read(), /Could not read/);
  }
  assert.equal(await getFreshAccessToken(env, binding), "fake-access");
});

test("refresh failure retains the consent record and gives explicit reauthorization", async (t) => {
  const env = credentialEnv();
  const binding = testBinding();
  const tokens = { accessToken: "fake-expired", refreshToken: "fake-rotating", expiresAt: 1 };
  await storeCredential(env, binding, tokens);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response("must-not-surface-upstream-credentials", { status: 400 });
  await assert.rejects(getFreshAccessToken(env, binding), /Reconnect/);
  assert.deepEqual(await readTokenRecord(env.YNAB_CREDENTIALS.storage(), binding, DATA_KEY), tokens);
});

test("ownership-verified deletion clears every scoped record and legacy data for only that user", async () => {
  const env = credentialEnv();
  const a = await approveFakeConsent(env, { access: "fake-a", writes: true });
  const b = await approveFakeConsent(env, { client: "client-b", access: "fake-b" });
  const peer = await approveFakeConsent(env, { user: "user-2", access: "fake-peer" });
  await createKvJournal(env, a).persist([{ id: "fake-operation-a" }]);
  await createKvJournal(env, b).persist([{ id: "fake-operation-b" }]);
  await env.OAUTH_KV.put(tokenRecordKey("user-1"), "legacy-token-ciphertext");
  await env.OAUTH_KV.put(undoJournalKey("user-1"), "legacy-journal-ciphertext");
  await env.OAUTH_KV.put(tokenRecordKey("user-2"), "peer-legacy-token-ciphertext");
  await deleteUserCredentials(env, "user-1");
  assert.deepEqual([...env.YNAB_CREDENTIALS.storage().values.keys()], ["deletion_generation"]);
  assert.equal(await env.OAUTH_KV.get(tokenRecordKey("user-1")), null);
  assert.equal(await env.OAUTH_KV.get(undoJournalKey("user-1")), null);
  assert.equal(await env.OAUTH_KV.get(tokenRecordKey("user-2")), "peer-legacy-token-ciphertext");
  await assert.rejects(getFreshAccessToken(env, a), /Reconnect/);
  await assert.rejects(getFreshAccessToken(env, b), /Reconnect/);
  assert.equal(await getFreshAccessToken(env, peer), "fake-peer");
});

test("durable journal CAS rejects stale persistence and safely merges concurrent state transforms", async () => {
  const env = credentialEnv();
  const binding = await approveFakeConsent(env);
  const a = createKvJournal(env, binding);
  const b = createKvJournal(env, binding);
  assert.deepEqual(await a.read(), []);
  assert.deepEqual(await b.read(), []);
  await a.persist([{ id: "fake-first" }]);
  await assert.rejects(b.persist([{ id: "fake-lost-update" }]), /changed concurrently/);
  const results = await Promise.all([
    a.mutate((entries) => { entries.push({ id: "fake-a" }); return "a-result"; }),
    b.mutate((entries) => { entries.push({ id: "fake-b" }); return "b-result"; }),
  ]);
  assert.deepEqual(results, ["a-result", "b-result"]);
  assert.deepEqual((await a.read()).map((entry) => entry.id).sort(), ["fake-a", "fake-b", "fake-first"]);
});

test("deletion invalidates previously displayed final consents and concurrent provider completion", async () => {
  const env = credentialEnv();
  const staleGeneration = await credentialGeneration(env, "user-1");
  await deleteUserCredentials(env, "user-1");
  let completed = 0;
  await assert.rejects(persistTokensAndAuthorize({ ...env, OAUTH_PROVIDER: {
    async completeAuthorization() { completed += 1; },
  } }, {
    record: { oauthReqInfo: { clientId: "fake-client" }, writesEnabled: true, credentialGeneration: staleGeneration },
    tokens: { accessToken: "fake-pending", expiresAt: Date.now() + 7200000 },
    ynabUserId: "user-1",
  }), /Could not store/);
  assert.equal(completed, 0);
  let binding;
  const revoked = [];
  await assert.rejects(persistTokensAndAuthorize({ ...env, OAUTH_PROVIDER: {
    async completeAuthorization(args) {
      binding = args.props;
      await deleteUserCredentials(env, "user-1");
      return { redirectTo: "https://fake.example/callback" };
    },
    async listUserGrants() { return { items: [
      { id: "fake-new-grant", metadata: { credentialId: binding.credentialId } },
      { id: "fake-unrelated-grant", metadata: { credentialId: "unrelated" } },
    ] }; },
    async revokeGrant(id, user) { revoked.push([id, user]); },
  } }, {
    record: { oauthReqInfo: { clientId: "fake-client" }, writesEnabled: true, credentialGeneration: await credentialGeneration(env, "user-1") },
    tokens: { accessToken: "fake-in-flight", expiresAt: Date.now() + 7200000 },
    ynabUserId: "user-1",
  }), /changed concurrently/);
  assert.deepEqual(revoked, [["fake-new-grant", "user-1"]]);
  await assert.rejects(getFreshAccessToken(env, binding), /Reconnect/);
});

test("failed durable deletion leaves credentials and deletion generation consistent", async () => {
  const env = credentialEnv();
  const binding = await approveFakeConsent(env);
  const storage = env.YNAB_CREDENTIALS.storage();
  const originalTransaction = storage.transaction.bind(storage);
  storage.transaction = async (callback) => originalTransaction(async (txn) => {
    const put = txn.put.bind(txn);
    txn.put = async (key, value) => {
      if (key === "deletion_generation") throw new Error("fake durable commit failure");
      return put(key, value);
    };
    return callback(txn);
  });
  await assert.rejects(deleteUserCredentials(env, "user-1"), /Could not delete/);
  assert.equal(await credentialGeneration(env, "user-1"), 0);
  assert.equal(await getFreshAccessToken(env, binding), "fake-access");
});

test("durable deletion clears large consent inventories in bounded storage batches", async () => {
  const env = credentialEnv();
  const storage = env.YNAB_CREDENTIALS.storage();
  for (let index = 0; index < 300; index += 1) await storage.put(`fake-encrypted-record:${index}`, "fake-ciphertext");
  const originalTransaction = storage.transaction.bind(storage);
  const batches = [];
  storage.transaction = (callback) => originalTransaction(async (txn) => {
    const remove = txn.delete.bind(txn);
    txn.delete = (keys) => {
      assert.ok(keys.length <= 128);
      batches.push(keys.length);
      return remove(keys);
    };
    return callback(txn);
  });
  await deleteUserCredentials(env, "user-1");
  assert.deepEqual(batches, [128, 128, 44]);
  assert.deepEqual([...storage.values.keys()], ["deletion_generation"]);
});

test("large encrypted journals commit bounded chunks atomically and remove superseded chunks", async () => {
  const env = credentialEnv();
  const binding = await approveFakeConsent(env);
  const storage = env.YNAB_CREDENTIALS.storage();
  const journal = createKvJournal(env, binding);
  const fakeMemo = "synthetic-financial-placeholder ".repeat(80000);
  const entry = { id: "fake-large-operation", memo: fakeMemo };
  await journal.persist([entry]);
  assert.deepEqual(await journal.read(), [entry]);
  const chunkKeys = [...storage.values.keys()].filter((key) => key.includes(":chunk:"));
  assert.ok(chunkKeys.length > 4, "fixture must exceed SQLite's single-value limit");
  for (const key of chunkKeys) {
    const value = await storage.get(key);
    assert.ok(value.length <= 512 * 1024);
    assert.doesNotMatch(value, /synthetic-financial-placeholder/);
  }
  const originalTransaction = storage.transaction.bind(storage);
  storage.transaction = (callback) => originalTransaction(async (txn) => {
    const put = txn.put.bind(txn);
    txn.put = async (key, value) => {
      if (key === undoJournalKey(binding)) throw new Error("fake manifest commit failure");
      return put(key, value);
    };
    return callback(txn);
  });
  await assert.rejects(journal.persist([{ id: "fake-replacement" }]), /Could not persist/);
  assert.deepEqual(await journal.read(), [entry]);
  storage.transaction = originalTransaction;
  await journal.persist([]);
  assert.equal([...storage.values.keys()].filter((key) => key.includes(":chunk:")).length, 1);
  await deleteUserCredentials(env, "user-1");
  assert.deepEqual([...storage.values.keys()], ["deletion_generation"]);
});

test("encrypted hosted journal supports recovery across MCP sessions without duplicate writes", async () => {
  const { createDurableOperationRunner } = await import("../../lib/write-recovery.mjs");
  const env = credentialEnv();
  const binding = await approveFakeConsent(env, { writes: true });
  const options = hostedServerOptions(env, binding, "fake-session-a");
  const amounts = new Map([["fake-source", 1000], ["fake-destination", 500]]);
  const writes = [];
  let destinationFailed = false;
  const readStep = async (step) => ({ budgeted: amounts.get(step.target.categoryId) });
  const writeStep = async (step) => {
    writes.push(step.target.categoryId);
    if (step.target.categoryId === "fake-destination" && !destinationFailed) {
      destinationFailed = true;
      throw new Error("fake failure before write");
    }
    amounts.set(step.target.categoryId, step.after.budgeted);
    if (step.target.categoryId === "fake-source") throw new Error("fake applied-write timeout");
  };
  const scope = { tenantId: options.tenantId, sessionId: options.sessionId, budgetId: "fake-budget", operationId: "fake-move" };
  const runner = createDurableOperationRunner({ journal: options.journal, readStep, writeStep });
  const result = await runner.run({ ...scope, tool: "fake-move-tool", steps: [
    { id: "fake-source-step", kind: "category_month", target: { categoryId: "fake-source" }, before: { budgeted: 1000 }, after: { budgeted: 0 } },
    { id: "fake-destination-step", kind: "category_month", target: { categoryId: "fake-destination" }, before: { budgeted: 500 }, after: { budgeted: 1500 } },
  ] });
  assert.equal(result.status, "partial");
  const reconnected = hostedServerOptions(env, binding, "fake-session-b");
  const recovery = createDurableOperationRunner({ journal: reconnected.journal, readStep, writeStep });
  const resumed = await recovery.resume({ ...scope, sessionId: reconnected.sessionId, allowSessionRebind: true });
  assert.equal(resumed.status, "completed");
  assert.deepEqual(writes, ["fake-source", "fake-destination", "fake-destination"]);
  assert.equal(amounts.get("fake-source"), 0);
  assert.equal(amounts.get("fake-destination"), 1500);
  const raw = await env.YNAB_CREDENTIALS.storage().get(undoJournalKey(binding));
  assert.doesNotMatch(raw, /fake-source|fake-move|budgeted/);
});

test("full MCP sessions keep client scope and HTTP credentials isolated", async (t) => {
  process.env.YNAB_MCP_NO_AUTOSTART = "1";
  process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
  const [{ createYnabServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import("../../index.js"),
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/inMemory.js"),
  ]);
  const env = credentialEnv();
  const writeBinding = await approveFakeConsent(env, { client: "write-client", writes: true, access: "fake-write-token" });
  const readBinding = await approveFakeConsent(env, { client: "read-client", access: "fake-read-token" });
  const authorizations = [];
  const sessions = [];
  t.after(async () => {
    await Promise.all(sessions.map(async ({ client, server }) => { await client.close(); await server.close(); }));
  });
  for (const binding of [writeBinding, readBinding]) {
    const { server } = createYnabServer({ ...hostedServerOptions(env, binding, `session-${binding.clientId}`), fetchImpl: async (_url, init) => {
      authorizations.push(new Headers(init.headers).get("authorization"));
      return Response.json({ data: { plans: [{ id: "fake-budget", name: "Synthetic budget" }] } });
    } });
    const client = new Client({ name: `fake-${binding.clientId}`, version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    sessions.push({ client, server, binding });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const listed = await client.listTools();
    assert.equal(listed.tools.some((tool) => tool.name === "ynab_write_tool_execute"), binding.writesEnabled);
    const result = await client.callTool({ name: "ynab_tool_execute", arguments: { tool_name: "list_budgets", input: {} } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
  }
  assert.deepEqual(authorizations, ["Bearer fake-write-token", "Bearer fake-read-token"]);
});

test("credential-bound sessions satisfy installed SDK naming checks and reject cross-grant attachment on every route", async () => {
  // Run the actual pinned framework's addressing, native name check, and MCP
  // parsers without loading its Cloudflare-only module into Node. A permissive
  // fake idFromName alone misses PartyServer's ctx.id.name/setName contract.
  const [partySource, mcpSource] = await Promise.all([
    readFile(new URL("../node_modules/partyserver/dist/index.js", import.meta.url), "utf8"),
    readFile(new URL("../node_modules/agents/dist/mcp/index.js", import.meta.url), "utf8"),
  ]);
  const between = (source, first, last) => {
    const start = source.indexOf(first);
    const end = source.indexOf(last, start);
    assert.ok(start >= 0 && end > start, `Pinned SDK method missing: ${first}`);
    return source.slice(start, end);
  };
  const getServerSource = between(partySource, "async function getServerByName(", "\nfunction camelCaseToKebabCase");
  const getServer = new Function("durableObjectGetOptions", "retryDurableObjectOperation", `${getServerSource}; return getServerByName;`)(() => undefined, (operation) => operation());
  const setNameSource = between(partySource, "\tasync setName(name, props)", "\n\t/**\n\t* @internal");
  const getTransportSource = between(mcpSource, "\tgetTransportType()", "\n\t/** Read the sessionId");
  const getSessionSource = between(mcpSource, "\tgetSessionId()", "\n\t/** Get the unique");
  const ProbeAgent = new Function(`return class ProbeAgent {
    #_name; #_props;
    constructor(id) { this.ctx = { id }; }
    async #ensureInitialized() { this.name = this.ctx.id.name; }
    get props() { return this.#_props; }
    ${setNameSource}
    ${getTransportSource}
    ${getSessionSource}
  };`)();
  const env = credentialEnv();
  const writer = await approveFakeConsent(env, { writes: true });
  const reader = await approveFakeConsent(env, { client: "fake-reader" });
  const peer = await approveFakeConsent(env, { user: "user-2" });
  const objects = new Map();
  let generated = 0;
  const namespace = {
    idFromName(name) { return { name }; },
    newUniqueId() { const value = `fake-session-${++generated}`; return { toString: () => value }; },
    get(id) {
      if (!objects.has(id.name)) objects.set(id.name, new ProbeAgent(id));
      return objects.get(id.name);
    },
  };
  const handler = withCredentialMcpNamespace({ async fetch(request, scopedEnv, ctx) {
    const url = new URL(request.url);
    const protocol = url.pathname.startsWith("/sse") ? "sse" : "streamable-http";
    let sessionId = request.headers.get("mcp-session-id") ?? url.searchParams.get("sessionId");
    if (!sessionId) {
      const id = scopedEnv.MCP_OBJECT.newUniqueId();
      sessionId = id.toString();
      assert.equal(id.toString(), sessionId, "generated IDs must have stable string representations");
    }
    const agent = await getServer(scopedEnv.MCP_OBJECT, `${protocol}:${sessionId}`, { props: ctx.props });
    assert.equal(agent.ctx.id.name, agent.name);
    assert.equal(agent.getTransportType(), protocol);
    assert.equal(agent.getSessionId(), sessionId, "SDK session parser must match public header/query ID");
    return Response.json({ sessionId, client: agent.props.clientId, writes: agent.props.writesEnabled });
  } });
  const boundEnv = { ...env, MCP_OBJECT: namespace };
  for (const path of ["/mcp", "/sse"]) {
    const initial = await handler.fetch(new Request(`https://fake.example${path}`), boundEnv, { props: writer });
    assert.equal(initial.status, 200);
    const { sessionId } = await initial.json();
    assert.match(sessionId, /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(sessionId, /:/);
    const routes = path === "/mcp" ? [["POST", "/mcp"], ["GET", "/mcp"], ["DELETE", "/mcp"]]
      : [["GET", "/sse"], ["POST", "/sse/message"]];
    for (const [method, route] of routes) {
      const request = () => new Request(`https://fake.example${route}${path === "/sse" ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`, {
        method, headers: path === "/mcp" ? { "mcp-session-id": sessionId } : {},
      });
      assert.deepEqual(await (await handler.fetch(request(), boundEnv, { props: writer })).json(), { sessionId, client: writer.clientId, writes: true });
      assert.equal((await handler.fetch(request(), boundEnv, { props: reader })).status, 403);
      assert.equal((await handler.fetch(request(), boundEnv, { props: peer })).status, 403);
      assert.equal((await handler.fetch(request(), boundEnv, { props: {} })).status, 401);
    }
  }
  assert.equal(objects.size, 2, "rejected grants must not reach or allocate a session object");
});
