import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
import test from "node:test";
import { connectorOrigins, createOriginScopedOAuthRouter } from "../src/connector-origin.js";
import { rejectUntrustedMcpOrigin } from "../src/mcp-origin.js";
import { captureSameOriginGrantIds, revokeCapturedGrants } from "../src/grant-replacement.js";

const OLD_ORIGIN = "https://ynab.amesvt.com";
const NEW_ORIGIN = "https://connector.example";

test("configured origins reject paths, credentials, and public HTTP origins", () => {
  assert.deepEqual(connectorOrigins({}, OLD_ORIGIN).allowedOrigins, new Set([OLD_ORIGIN]));
  assert.deepEqual(connectorOrigins({
    CONNECTOR_BASE_URL: `${NEW_ORIGIN}/`,
    CONNECTOR_COMPATIBILITY_ORIGINS: ` ${OLD_ORIGIN}, ${OLD_ORIGIN} `,
  }, OLD_ORIGIN), {
    canonicalOrigin: NEW_ORIGIN,
    allowedOrigins: new Set([NEW_ORIGIN, OLD_ORIGIN]),
  });
  for (const origin of [
    `${NEW_ORIGIN}/mcp`, `${NEW_ORIGIN}?host=old`, `${NEW_ORIGIN}#fragment`,
    "https://user:password@connector.example", "http://connector.example", "not-an-origin",
  ]) {
    assert.throws(() => connectorOrigins({ CONNECTOR_BASE_URL: origin }, OLD_ORIGIN));
    assert.throws(() => connectorOrigins({
      CONNECTOR_BASE_URL: NEW_ORIGIN,
      CONNECTOR_COMPATIBILITY_ORIGINS: origin,
    }, OLD_ORIGIN));
  }
});

test("origin routing keeps shared bindings and canonical display configuration request-local", async () => {
  const calls = [];
  const providers = [];
  const env = Object.freeze({
    CONNECTOR_BASE_URL: NEW_ORIGIN,
    CONNECTOR_COMPATIBILITY_ORIGINS: OLD_ORIGIN,
    OAUTH_KV: Object.freeze({ fixture: "shared-kv" }),
    YNAB_CREDENTIALS: Object.freeze({ fixture: "shared-credentials" }),
    COOKIE_ENCRYPTION_KEY: "synthetic-cookie-key",
    DATA_ENCRYPTION_KEY: "synthetic-data-key",
  });
  const ctx = { fixture: "context" };
  const options = { allowPlainPKCE: false, tokenEndpoint: "/token", resourceMetadata: { scopes_supported: ["read", "write"] } };
  const router = createOriginScopedOAuthRouter({
    defaultOrigin: OLD_ORIGIN,
    providerOptions: options,
    createProvider(providerOptions) {
      providers.push(providerOptions);
      return { async fetch(request, requestEnv, context) {
        calls.push({ request, env: requestEnv, ctx: context });
        requestEnv.OAUTH_PROVIDER = { fixture: "request-only-helper" };
        return new Response("ok");
      } };
    },
  });
  for (const origin of [OLD_ORIGIN, NEW_ORIGIN, OLD_ORIGIN]) {
    assert.equal((await router.fetch(new Request(`${origin}/mcp`), env, ctx)).status, 200);
  }
  assert.equal(providers.length, 2);
  for (const [index, origin] of [OLD_ORIGIN, NEW_ORIGIN].entries()) {
    assert.deepEqual(providers[index].resourceMetadata, {
      scopes_supported: ["read", "write"], resource: `${origin}/mcp`, authorization_servers: [origin],
    });
    assert.equal(providers[index].allowPlainPKCE, false);
    assert.equal(providers[index].tokenEndpoint, "/token");
  }
  for (const { request, env: scoped, ctx: context } of calls) {
    assert.equal(scoped.CONNECTOR_BASE_URL, new URL(request.url).origin);
    assert.equal(scoped.CONNECTOR_CANONICAL_URL, NEW_ORIGIN);
    assert.equal(scoped.OAUTH_KV, env.OAUTH_KV);
    assert.equal(scoped.YNAB_CREDENTIALS, env.YNAB_CREDENTIALS);
    assert.equal(scoped.COOKIE_ENCRYPTION_KEY, env.COOKIE_ENCRYPTION_KEY);
    assert.equal(scoped.DATA_ENCRYPTION_KEY, env.DATA_ENCRYPTION_KEY);
    assert.equal(context, ctx);
  }
  assert.notEqual(calls[0].env, calls[2].env);
  assert.equal(env.OAUTH_PROVIDER, undefined);
  assert.equal(env.CONNECTOR_BASE_URL, NEW_ORIGIN);
  assert.deepEqual(options.resourceMetadata, { scopes_supported: ["read", "write"] });
});

test("unconfigured request origins and malformed configuration fail before provider or origin processing", async () => {
  let providerCalls = 0;
  let guardCalls = 0;
  const router = createOriginScopedOAuthRouter({
    defaultOrigin: OLD_ORIGIN,
    providerOptions: {},
    createProvider() { providerCalls++; throw new Error("Must not create a provider"); },
    beforeFetch() { guardCalls++; throw new Error("Must not enter the browser origin guard"); },
  });
  const env = { CONNECTOR_BASE_URL: NEW_ORIGIN, CONNECTOR_COMPATIBILITY_ORIGINS: OLD_ORIGIN };
  for (const host of ["attacker.example", "ynab.amesvt.com.attacker.example", "connector.example.attacker.example"]) {
    const response = await router.fetch(new Request(`https://${host}/authorize`, {
      headers: { Origin: NEW_ORIGIN, "X-Forwarded-Host": "connector.example" },
    }), env, {});
    assert.equal(response.status, 421);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).error, "unconfigured_connector_origin");
  }
  const misconfigured = await router.fetch(new Request(`${NEW_ORIGIN}/mcp`), {
    ...env, CONNECTOR_COMPATIBILITY_ORIGINS: "https://fixture-secret@old.example/path",
  }, {});
  assert.equal(misconfigured.status, 500);
  assert.doesNotMatch(await misconfigured.text(), /fixture-secret/);
  assert.equal(providerCalls, 0);
  assert.equal(guardCalls, 0);
});

test("trusted browser origins are checked against the selected connector origin", async () => {
  let providerCalls = 0;
  const router = createOriginScopedOAuthRouter({
    defaultOrigin: OLD_ORIGIN,
    providerOptions: {},
    beforeFetch: rejectUntrustedMcpOrigin,
    createProvider() { return { async fetch() { providerCalls++; return new Response("ok"); } }; },
  });
  const env = {
    CONNECTOR_BASE_URL: NEW_ORIGIN, CONNECTOR_COMPATIBILITY_ORIGINS: OLD_ORIGIN,
    MCP_ALLOWED_ORIGINS: "https://chatgpt.com",
  };
  for (const origin of [OLD_ORIGIN, NEW_ORIGIN]) {
    assert.equal((await router.fetch(new Request(`${origin}/mcp`, { headers: { Origin: origin } }), env, {})).status, 200);
    assert.equal((await router.fetch(new Request(`${origin}/mcp`, { headers: { Origin: "https://chatgpt.com" } }), env, {})).status, 200);
    const otherOrigin = origin === OLD_ORIGIN ? NEW_ORIGIN : OLD_ORIGIN;
    assert.equal((await router.fetch(new Request(`${origin}/mcp`, { headers: { Origin: otherOrigin } }), env, {})).status, 403);
  }
  assert.equal(providerCalls, 4);
});

test("loopback development accepts only its configured origin and port", async () => {
  const router = createOriginScopedOAuthRouter({
    defaultOrigin: OLD_ORIGIN, providerOptions: {},
    createProvider() { return { async fetch() { return new Response("ok"); } }; },
  });
  const env = { CONNECTOR_BASE_URL: "http://localhost:8787" };
  assert.equal((await router.fetch(new Request("http://localhost:8787/mcp"), env, {})).status, 200);
  assert.equal((await router.fetch(new Request("http://localhost:8788/mcp"), env, {})).status, 421);
  assert.equal((await router.fetch(new Request("http://127.0.0.1:8787/mcp"), env, {})).status, 421);
});

// Only the WorkerEntrypoint runtime import is bridged for Node. The installed
// OAuth provider's DCR, PKCE, crypto, grants, audience checks, and refresh logic
// below run unchanged; deployment verification also exercises actual workerd.
register(`data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return {
      url: "data:text/javascript,export class WorkerEntrypoint {}", shortCircuit: true,
    };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);
const { default: OAuthProvider } = await import("@cloudflare/workers-oauth-provider");

class MemoryKv {
  values = new Map();
  async get(key, options) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return options === "json" || options?.type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(key, value); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix = "" } = {}) {
    return { keys: [...this.values.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true, cursor: "" };
  }
}

function providerRouter({ replaceGrants = true, revokeGrant } = {}) {
  return createOriginScopedOAuthRouter({
    defaultOrigin: OLD_ORIGIN,
    beforeFetch: rejectUntrustedMcpOrigin,
    createProvider: (options) => new OAuthProvider(options),
    providerOptions: {
      apiRoute: "/mcp",
      apiHandler: { async fetch(request, env, ctx) { return Response.json({ origin: env.CONNECTOR_BASE_URL, props: ctx.props }); } },
      defaultHandler: { async fetch(request, env) {
        const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
        const priorIds = await captureSameOriginGrantIds(env, env.OAUTH_PROVIDER, {
          userId: "synthetic-user", clientId: authRequest.clientId,
        });
        const result = await env.OAUTH_PROVIDER.completeAuthorization({
          request: authRequest, userId: "synthetic-user", scope: ["read"],
          props: { userId: "synthetic-user", credentialId: `${env.CONNECTOR_BASE_URL}-consent`, writesEnabled: false },
          revokeExistingGrants: false,
        });
        if (replaceGrants) {
          const replacementProvider = revokeGrant
            ? { revokeGrant: (id, userId) => revokeGrant(env.OAUTH_PROVIDER, id, userId) }
            : env.OAUTH_PROVIDER;
          await revokeCapturedGrants(replacementProvider, "synthetic-user", priorIds);
        }
        return Response.redirect(result.redirectTo, 302);
      } },
      authorizeEndpoint: "/authorize", tokenEndpoint: "/token", clientRegistrationEndpoint: "/register",
      scopesSupported: ["read", "write"], allowPlainPKCE: false,
      resourceMetadata: { scopes_supported: ["read", "write"], bearer_methods_supported: ["header"], resource_name: "YNAB" },
    },
  });
}

async function routerRequest(router, env, url, init) {
  const pending = [];
  const response = await router.fetch(new Request(url, init), env, { props: {}, waitUntil(promise) { pending.push(promise); } });
  await Promise.all(pending);
  return response;
}

async function authorizeFixture(router, env, origin, existingClientId) {
  const redirectUri = "https://mcp-client.example/callback";
  let clientId = existingClientId;
  if (!clientId) {
    const registration = await routerRequest(router, env, `${origin}/register`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: "Synthetic migration client", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
    });
    assert.equal(registration.status, 201, await registration.clone().text());
    ({ client_id: clientId } = await registration.json());
  }
  const verifier = "synthetic-pkce-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "read",
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"), resource: `${origin}/mcp`,
  });
  const authorize = await routerRequest(router, env, `${origin}/authorize?${params}`);
  assert.equal(authorize.status, 302, await authorize.clone().text());
  const redirect = new URL(authorize.headers.get("location"));
  assert.equal(redirect.searchParams.get("iss"), origin);
  const exchange = await routerRequest(router, env, `${origin}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "authorization_code", code: redirect.searchParams.get("code"), code_verifier: verifier, redirect_uri: redirectUri, resource: `${origin}/mcp` }),
  });
  assert.equal(exchange.status, 200, await exchange.clone().text());
  const tokens = await exchange.json();
  assert.equal(tokens.resource, `${origin}/mcp`);
  return { clientId, tokens };
}

test("existing old-origin grants survive migration with exact issuer, resource, and refresh isolation", async () => {
  const kv = new MemoryKv();
  const originalEnv = { CONNECTOR_BASE_URL: OLD_ORIGIN, OAUTH_KV: kv };
  const oldGrant = await authorizeFixture(providerRouter(), originalEnv, OLD_ORIGIN);

  // A new router models a new Worker deployment using the SAME grant storage.
  const router = providerRouter();
  const migratedEnv = { ...originalEnv, CONNECTOR_BASE_URL: NEW_ORIGIN, CONNECTOR_COMPATIBILITY_ORIGINS: OLD_ORIGIN };
  for (const origin of [OLD_ORIGIN, NEW_ORIGIN]) {
    const discovery = await routerRequest(router, migratedEnv, `${origin}/.well-known/oauth-authorization-server`);
    assert.equal(discovery.status, 200);
    const metadata = await discovery.json();
    assert.equal(metadata.issuer, origin);
    assert.equal(metadata.authorization_endpoint, `${origin}/authorize`);
    assert.equal(metadata.token_endpoint, `${origin}/token`);
    assert.equal(metadata.registration_endpoint, `${origin}/register`);
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const resource = await (await routerRequest(router, migratedEnv, `${origin}${path}`)).json();
      assert.equal(resource.resource, `${origin}/mcp`);
      assert.deepEqual(resource.authorization_servers, [origin]);
    }
    const challenge = await routerRequest(router, migratedEnv, `${origin}/mcp`);
    assert.equal(challenge.status, 401);
    assert.ok(challenge.headers.get("www-authenticate").includes(`resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`));
  }
  const newGrant = await authorizeFixture(router, migratedEnv, NEW_ORIGIN);
  for (const [origin, ownGrant, otherGrant] of [[OLD_ORIGIN, oldGrant, newGrant], [NEW_ORIGIN, newGrant, oldGrant]]) {
    const accepted = await routerRequest(router, migratedEnv, `${origin}/mcp`, { headers: { Authorization: `Bearer ${ownGrant.tokens.access_token}` } });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).origin, origin);
    const rejected = await routerRequest(router, migratedEnv, `${origin}/mcp`, { headers: { Authorization: `Bearer ${otherGrant.tokens.access_token}` } });
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).error, "invalid_token");

    const crossedRefresh = await routerRequest(router, migratedEnv, `${origin}/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: otherGrant.clientId, grant_type: "refresh_token", refresh_token: otherGrant.tokens.refresh_token, resource: `${origin}/mcp` }),
    });
    assert.equal(crossedRefresh.status, 400);
    assert.equal((await crossedRefresh.json()).error, "invalid_target");
    const ownRefresh = await routerRequest(router, migratedEnv, `${origin}/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: ownGrant.clientId, grant_type: "refresh_token", refresh_token: ownGrant.tokens.refresh_token, resource: `${origin}/mcp` }),
    });
    assert.equal(ownRefresh.status, 200, await ownRefresh.clone().text());
    ownGrant.tokens = await ownRefresh.json();
    assert.equal(ownGrant.tokens.resource, `${origin}/mcp`);
    assert.equal((await routerRequest(router, migratedEnv, `${origin}/mcp`, { headers: { Authorization: `Bearer ${ownGrant.tokens.access_token}` } })).status, 200);
  }
  assert.equal(originalEnv.OAUTH_PROVIDER, undefined);
  assert.equal(migratedEnv.OAUTH_PROVIDER, undefined);
});

test("same client can reconnect on either origin without revoking the other origin's grant", async () => {
  const router = providerRouter();
  const env = { CONNECTOR_BASE_URL: NEW_ORIGIN, CONNECTOR_COMPATIBILITY_ORIGINS: OLD_ORIGIN, OAUTH_KV: new MemoryKv() };
  const oldGrant = await authorizeFixture(router, env, OLD_ORIGIN);
  const newGrant = await authorizeFixture(router, env, NEW_ORIGIN, oldGrant.clientId);
  const bearer = (origin, grant) => routerRequest(router, env, `${origin}/mcp`, { headers: { Authorization: `Bearer ${grant.tokens.access_token}` } });
  assert.equal((await bearer(OLD_ORIGIN, oldGrant)).status, 200);
  assert.equal((await bearer(NEW_ORIGIN, newGrant)).status, 200);
  assert.equal((await bearer(NEW_ORIGIN, oldGrant)).status, 401);
  assert.equal((await bearer(OLD_ORIGIN, newGrant)).status, 401);

  const newReconnection = await authorizeFixture(router, env, NEW_ORIGIN, oldGrant.clientId);
  assert.equal((await bearer(NEW_ORIGIN, newGrant)).status, 401, "same-origin reconnect replaces its old grant");
  assert.equal((await bearer(NEW_ORIGIN, newReconnection)).status, 200);
  assert.equal((await bearer(OLD_ORIGIN, oldGrant)).status, 200, "other-origin grant survives reconnect");

  const refresh = (origin, grant) => routerRequest(router, env, `${origin}/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: grant.clientId, grant_type: "refresh_token", refresh_token: grant.tokens.refresh_token, resource: `${origin}/mcp` }),
  });
  const crossedRefresh = await refresh(NEW_ORIGIN, oldGrant);
  assert.equal(crossedRefresh.status, 400);
  assert.equal((await crossedRefresh.json()).error, "invalid_target");
  const oldRefresh = await refresh(OLD_ORIGIN, oldGrant);
  assert.equal(oldRefresh.status, 200, await oldRefresh.clone().text());
  oldGrant.tokens = await oldRefresh.json();
  assert.equal((await bearer(OLD_ORIGIN, oldGrant)).status, 200);

  const oldReconnection = await authorizeFixture(router, env, OLD_ORIGIN, oldGrant.clientId);
  assert.equal((await bearer(OLD_ORIGIN, oldGrant)).status, 401);
  assert.equal((await bearer(OLD_ORIGIN, oldReconnection)).status, 200);
  assert.equal((await bearer(NEW_ORIGIN, newReconnection)).status, 200);
  const newRefresh = await refresh(NEW_ORIGIN, newReconnection);
  assert.equal(newRefresh.status, 200, await newRefresh.clone().text());
  newReconnection.tokens = await newRefresh.json();
  assert.equal((await bearer(NEW_ORIGIN, newReconnection)).status, 200);
});

test("grant replacement inspects every page privately and preserves other or ambiguous resources", async () => {
  const records = {
    "grant:user:own": { id: "own", userId: "user", clientId: "client", resource: `${OLD_ORIGIN}/mcp`, encryptedProps: "synthetic-sensitive-props" },
    "grant:user:other-origin": { id: "other-origin", userId: "user", clientId: "client", resource: `${NEW_ORIGIN}/mcp` },
    "grant:user:ambiguous": { id: "ambiguous", userId: "user", clientId: "client" },
    "grant:user:foreign": { id: "foreign", userId: "foreign-user", clientId: "client", resource: `${OLD_ORIGIN}/mcp` },
  };
  const readKeys = [];
  const pages = [
    { items: [{ id: "other-origin", userId: "user", clientId: "client" }, { id: "ambiguous", userId: "user", clientId: "client" }], cursor: "next" },
    { items: [{ id: "own", userId: "user", clientId: "client" }, { id: "foreign", userId: "user", clientId: "client" }, { id: "other-client", userId: "user", clientId: "different-client" }] },
  ];
  let pageIndex = 0;
  const oauthProvider = { async listUserGrants(userId, options) {
    assert.equal(userId, "user");
    assert.equal(options.cursor, pageIndex === 0 ? undefined : "next");
    return pages[pageIndex++];
  } };
  const priorIds = await captureSameOriginGrantIds({
    CONNECTOR_BASE_URL: OLD_ORIGIN,
    OAUTH_KV: { async get(key, options) { readKeys.push(key); assert.deepEqual(options, { type: "json" }); return records[key]; } },
  }, oauthProvider, { userId: "user", clientId: "client" });
  assert.deepEqual(priorIds, ["own"]);
  assert.equal(pageIndex, 2);
  assert.deepEqual(readKeys, ["grant:user:other-origin", "grant:user:ambiguous", "grant:user:own", "grant:user:foreign"]);
  const revoked = [];
  await revokeCapturedGrants({ async revokeGrant(id, userId) { revoked.push({ id, userId }); } }, "user", priorIds);
  assert.deepEqual(revoked, [{ id: "own", userId: "user" }]);

  await assert.rejects(captureSameOriginGrantIds({
    CONNECTOR_BASE_URL: OLD_ORIGIN, OAUTH_KV: { async get() { throw new Error("synthetic storage failure"); } },
  }, { async listUserGrants() { return { items: [{ id: "own", userId: "user", clientId: "client" }] }; } }, { userId: "user", clientId: "client" }), /synthetic storage failure/);
  await assert.rejects(captureSameOriginGrantIds({ CONNECTOR_BASE_URL: OLD_ORIGIN, OAUTH_KV: { async get() {} } }, {
    async listUserGrants() { throw new Error("synthetic listing failure"); },
  }, { userId: "user", clientId: "client" }), /synthetic listing failure/);
});

test("actual OAuth provider supports configured HTTP loopback discovery and token flow", async () => {
  const origin = "http://localhost:8787";
  const router = providerRouter();
  const env = { CONNECTOR_BASE_URL: origin, OAUTH_KV: new MemoryKv() };
  const metadata = await (await routerRequest(router, env, `${origin}/.well-known/oauth-authorization-server`)).json();
  assert.equal(metadata.issuer, origin);
  assert.equal(metadata.token_endpoint, `${origin}/token`);
  const protectedResource = await (await routerRequest(router, env, `${origin}/.well-known/oauth-protected-resource/mcp`)).json();
  assert.equal(protectedResource.resource, `${origin}/mcp`);
  assert.deepEqual(protectedResource.authorization_servers, [origin]);
  const grant = await authorizeFixture(router, env, origin);
  const accepted = await routerRequest(router, env, `${origin}/mcp`, { headers: { Authorization: `Bearer ${grant.tokens.access_token}` } });
  assert.equal(accepted.status, 200);
});

test("resource arrays use the provider's exact singleton rule during grant replacement", async () => {
  const resource = `${OLD_ORIGIN}/mcp`;
  const values = new Map([
    ["string", resource], ["singleton", [resource]], ["empty", []],
    ["repeated", [resource, resource]], ["mixed", [resource, `${NEW_ORIGIN}/mcp`]],
    ["foreign", [`${NEW_ORIGIN}/mcp`]],
  ]);
  const ids = await captureSameOriginGrantIds({
    CONNECTOR_BASE_URL: OLD_ORIGIN,
    OAUTH_KV: { async get(key) {
      const id = key.split(":")[2];
      return { id, userId: "user", clientId: "client", resource: values.get(id) };
    } },
  }, { async listUserGrants() {
    return { items: [...values.keys()].map((id) => ({ id, userId: "user", clientId: "client" })) };
  } }, { userId: "user", clientId: "client" });
  assert.deepEqual(ids, ["string", "singleton"]);
});

test("partial old-grant cleanup failure preserves the newly valid provider grant", async () => {
  const env = { CONNECTOR_BASE_URL: OLD_ORIGIN, OAUTH_KV: new MemoryKv() };
  const fixtureRouter = providerRouter({ replaceGrants: false });
  const first = await authorizeFixture(fixtureRouter, env, OLD_ORIGIN);
  const second = await authorizeFixture(fixtureRouter, env, OLD_ORIGIN, first.clientId);
  const firstId = first.tokens.access_token.split(":")[1];
  const secondId = second.tokens.access_token.split(":")[1];
  const attempted = [];
  const router = providerRouter({ revokeGrant(provider, id, userId) {
    attempted.push(id);
    if (id === firstId) throw new Error("synthetic cleanup failure");
    return provider.revokeGrant(id, userId);
  } });
  const replacement = await authorizeFixture(router, env, OLD_ORIGIN, first.clientId);
  assert.deepEqual(new Set(attempted), new Set([firstId, secondId]));
  const bearer = (grant) => routerRequest(router, env, `${OLD_ORIGIN}/mcp`, {
    headers: { Authorization: `Bearer ${grant.tokens.access_token}` },
  });
  assert.equal((await bearer(first)).status, 200, "failed cleanup retains only that prior grant");
  assert.equal((await bearer(second)).status, 401, "successful prior cleanup still completes");
  assert.equal((await bearer(replacement)).status, 200, "the new valid grant survives partial prior cleanup failure");
  assert.equal(attempted.includes(replacement.tokens.access_token.split(":")[1]), false);
});
