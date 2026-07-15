import assert from "node:assert/strict";
import test from "node:test";

import {
  YnabHandler,
  persistTokensAndAuthorize,
  revokeAllUserGrants,
} from "../src/ynab-handler.js";
import { consentPage, errorPage } from "../src/pages.js";
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

function hiddenValue(html, name) {
  const match = html.match(new RegExp(`name="${name}" value="([^"]+)"`));
  assert.ok(match, `missing hidden input ${name}`);
  return match[1];
}

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
  const cookie = (getResponse.headers.get("set-cookie") ?? "").split(";")[0];
  assert.ok(await kv.get(`oauth_consent:${consentId}`));

  const postResponse = await YnabHandler.request("https://untrusted-preview.example/authorize", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams({ consent: consentId, csrf }),
  }, env);

  assert.equal(postResponse.status, 302);
  const location = new URL(postResponse.headers.get("location"));
  assert.equal(location.origin, "https://app.ynab.com");
  assert.equal(location.searchParams.get("scope"), "read-only");
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  assert.equal(location.searchParams.get("redirect_uri"), "https://ynab.amesvt.com/callback");
  assert.equal(await kv.get(`oauth_consent:${consentId}`), null);
});
