import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { runHostedConsent, runHostedSmoke } from "../scripts/lib/hosted-smoke.mjs";
import { createOpTokenStore } from "../scripts/lib/op-token-store.mjs";

process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
const { createYnabServer } = await import("../index.js");
const { packageJson } = await import("../scripts/lib/smoke-client.mjs");

const token = () => randomBytes(12).toString("hex");

// A local stand-in for the hosted connector: the provider's discovery,
// dynamic registration, PKCE authorization-code and rotating refresh-token
// endpoints, plus a bearer-protected Streamable HTTP /mcp.
async function startMockConnector({ grantScope = "read", serverFactory, rejectRefresh = false } = {}) {
  const clients = new Map();
  const codes = new Map();
  const accessTokens = new Set();
  const grant = { current: null, previous: null };
  const seen = { authorize: [], token: [], refreshCalls: 0 };
  let origin;

  const defaultFactory = () => createYnabServer({
    getAccessToken: async () => "unused",
    hasCredentials: true,
    writesEnabled: false,
    serverInfo: { name: "YNAB", version: packageJson.version },
  }).server;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/register") {
      const body = JSON.parse(raw);
      assert.equal(body.token_endpoint_auth_method, "none");
      const clientId = `client-${token()}`;
      clients.set(clientId, body.redirect_uris);
      return json(201, { client_id: clientId });
    }
    if (url.pathname === "/authorize") {
      seen.authorize.push(Object.fromEntries(url.searchParams));
      const clientId = url.searchParams.get("client_id");
      const redirect = url.searchParams.get("redirect_uri");
      if (!clients.has(clientId) || new URL(redirect).hostname !== "127.0.0.1") {
        return json(400, { error: "invalid_request" });
      }
      const code = token();
      codes.set(code, { clientId, redirect, challenge: url.searchParams.get("code_challenge") });
      const back = new URL(redirect);
      back.search = new URLSearchParams({ code, state: url.searchParams.get("state"), iss: origin }).toString();
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === "/token") {
      const form = new URLSearchParams(raw);
      seen.token.push(Object.fromEntries(form));
      if (form.get("resource") !== `${origin}/mcp`) return json(400, { error: "invalid_target" });
      if (form.get("grant_type") === "authorization_code") {
        const entry = codes.get(form.get("code"));
        const verifier = form.get("code_verifier") ?? "";
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        if (!entry || entry.challenge !== challenge || entry.clientId !== form.get("client_id")) {
          return json(400, { error: "invalid_grant", error_description: "bad code or verifier" });
        }
        codes.delete(form.get("code"));
        grant.current = `rt-${token()}`;
        grant.clientId = entry.clientId;
        const access = `at-${token()}`;
        accessTokens.add(access);
        return json(200, { access_token: access, token_type: "bearer", expires_in: 7200, refresh_token: grant.current, scope: grantScope });
      }
      if (form.get("grant_type") === "refresh_token") {
        seen.refreshCalls += 1;
        const provided = form.get("refresh_token");
        if (rejectRefresh || (provided !== grant.current && provided !== grant.previous) || form.get("client_id") !== grant.clientId) {
          return json(400, { error: "invalid_grant", error_description: "Invalid refresh token" });
        }
        grant.previous = provided;
        grant.current = `rt-${token()}`;
        const access = `at-${token()}`;
        accessTokens.add(access);
        return json(200, { access_token: access, token_type: "bearer", expires_in: 7200, refresh_token: grant.current, scope: grantScope });
      }
    }
    if (url.pathname === "/mcp") {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (!bearer || !accessTokens.has(bearer)) {
        res.writeHead(401, { "www-authenticate": 'Bearer error="invalid_token"' });
        return res.end();
      }
      const mcp = (serverFactory ?? defaultFactory)();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); mcp.close(); });
      await mcp.connect(transport);
      return transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    url: `${origin}/mcp`,
    seen,
    grant,
    close: () => { server.closeAllConnections(); server.close(); },
  };
}

function memoryStore(initial = null, { failSave = false } = {}) {
  const state = { record: initial, saves: [] };
  return {
    state,
    describe: () => "memory store",
    read: async () => state.record,
    save: async (update) => {
      if (failSave && !update.clientId) throw new Error("vault locked");
      state.saves.push(Object.keys(update));
      state.record = { ...state.record, ...Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined)) };
      return state.record ? "updated" : "created";
    },
  };
}

// The "browser": follows the consent page's redirect to the loopback callback.
const browser = (mutate = (href) => href) => async (authorizeUrl) => {
  const response = await fetch(authorizeUrl, { redirect: "manual" });
  const location = response.headers.get("location");
  assert.ok(location, `authorize responded ${response.status}`);
  fetch(mutate(location)).catch(() => {});
};

async function consent(connector, store, options = {}) {
  const logs = [];
  await runHostedConsent({ store, url: connector.url, log: (line) => logs.push(line), openBrowser: browser(options.mutate), ...options });
  return logs;
}

test("consent registers a public loopback client, requests read scope, and stores the grant", async (t) => {
  const connector = await startMockConnector(); t.after(connector.close);
  const store = memoryStore();
  const logs = await consent(connector, store, { now: () => Date.parse("2026-10-25T12:00:00Z") });
  assert.equal(store.state.record.clientId.startsWith("client-"), true);
  assert.equal(store.state.record.mcpUrl, connector.url);
  assert.equal(store.state.record.consentedAt, "2026-10-25T12:00:00.000Z");
  assert.equal(store.state.record.refreshToken, connector.grant.current);
  const [authorize] = connector.seen.authorize;
  assert.equal(authorize.scope, "read");
  assert.equal(authorize.resource, connector.url);
  assert.equal(authorize.code_challenge_method, "S256");
  assert.match(authorize.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  assert.ok(!logs.join("\n").includes(connector.grant.current), "the refresh token must not be logged");
});

test("consent refuses and stores nothing when the grant includes write access", async (t) => {
  const connector = await startMockConnector({ grantScope: "read write" }); t.after(connector.close);
  const store = memoryStore();
  await assert.rejects(consent(connector, store), /includes write access/);
  assert.equal(store.state.record, null);
});

test("consent aborts on a state mismatch and on a denied authorization", async (t) => {
  const connector = await startMockConnector(); t.after(connector.close);
  const store = memoryStore();
  await assert.rejects(
    consent(connector, store, { mutate: (href) => href.replace(/state=[^&]+/, "state=forged") }),
    /state did not match/,
  );
  await assert.rejects(
    consent(connector, store, { mutate: (href) => { const u = new URL(href); u.search = `?error=access_denied&state=${u.searchParams.get("state")}`; return u.href; } }),
    /access_denied/,
  );
  assert.equal(store.state.record, null);
});

test("smoke reuses the stored grant, saves each rotated refresh token, and matches this checkout", async (t) => {
  const connector = await startMockConnector(); t.after(connector.close);
  const store = memoryStore();
  await consent(connector, store);
  const first = store.state.record.refreshToken;

  const logs = [];
  const result = await runHostedSmoke({ store, url: connector.url, log: (line) => logs.push(line) });
  assert.equal(result.writesEnabled, false);
  assert.ok(result.toolCount > 40, `expected a full read-only tool surface, saw ${result.toolCount}`);
  assert.notEqual(store.state.record.refreshToken, first);
  assert.equal(store.state.record.refreshToken, connector.grant.current);
  assert.equal(store.state.record.clientId.startsWith("client-"), true, "rotation keeps the client id");

  const second = store.state.record.refreshToken;
  await runHostedSmoke({ store, url: connector.url, log: (line) => logs.push(line) });
  assert.notEqual(store.state.record.refreshToken, second);
  assert.equal(connector.seen.refreshCalls, 2);
  const output = logs.join("\n");
  for (const secret of [first, second, store.state.record.refreshToken]) assert.ok(!output.includes(secret));
  assert.match(output, /Hosted smoke check passed/);
});

test("smoke warns when the rotated token cannot be saved, and the previous token still works", async (t) => {
  const connector = await startMockConnector(); t.after(connector.close);
  const store = memoryStore(null, { failSave: true });
  await consent(connector, store);
  const logs = [];
  await runHostedSmoke({ store, url: connector.url, log: (line) => logs.push(line) });
  await runHostedSmoke({ store, url: connector.url, log: (line) => logs.push(line) });
  assert.match(logs.join("\n"), /could not save the rotated refresh token \(vault locked\)/);
  assert.equal(connector.seen.refreshCalls, 2);
});

test("smoke fails when the deployed server differs from this checkout", async (t) => {
  const variants = {
    "wrong version": () => createYnabServer({ getAccessToken: async () => "x", hasCredentials: true, writesEnabled: false, serverInfo: { name: "YNAB", version: "0.0.1" } }).server,
    "no instructions": () => {
      const server = new McpServer({ name: "YNAB", version: packageJson.version });
      server.registerTool("ynab_tool_index", { description: "index" }, async () => ({ content: [{ type: "text", text: "{}" }] }));
      return server;
    },
  };
  for (const [name, serverFactory] of Object.entries(variants)) {
    const connector = await startMockConnector({ serverFactory });
    try {
      const store = memoryStore();
      await consent(connector, store);
      await assert.rejects(
        runHostedSmoke({ store, url: connector.url, log: () => {} }),
        name === "wrong version" ? /server version 0\.0\.1/ : /no instructions[\s\S]*missing tools/,
        name,
      );
    } finally {
      connector.close();
    }
  }
});

test("smoke tells the owner how to renew an expired or revoked grant", async (t) => {
  const connector = await startMockConnector(); t.after(connector.close);
  const store = memoryStore();
  await consent(connector, store);
  connector.grant.current = null;
  connector.grant.previous = null;
  await assert.rejects(runHostedSmoke({ store, url: connector.url, log: () => {} }), /expired or was revoked[\s\S]*npm run smoke:hosted:consent/);
});

test("smoke without a stored grant, or with one for another endpoint, explains the next step", async (t) => {
  const connector = await startMockConnector(); t.after(connector.close);
  await assert.rejects(runHostedSmoke({ store: memoryStore(), url: connector.url, log: () => {} }), /npm run smoke:hosted:consent/);
  const other = memoryStore({ refreshToken: "x", clientId: "y", mcpUrl: "https://elsewhere.example/mcp" });
  await assert.rejects(runHostedSmoke({ store: other, url: connector.url, log: () => {} }), /issued for https:\/\/elsewhere\.example\/mcp/);
});

test("smoke warns as the 30-day grant nears its end", async (t) => {
  const connector = await startMockConnector(); t.after(connector.close);
  const store = memoryStore();
  await consent(connector, store, { now: () => Date.parse("2026-10-01T00:00:00Z") });
  const logs = [];
  await runHostedSmoke({ store, url: connector.url, log: (line) => logs.push(line), now: () => Date.parse("2026-10-27T00:00:00Z") });
  assert.match(logs[0], /26 days old.*npm run smoke:hosted:consent/);
});

test("1Password store sends secrets in a private template file, never as arguments, and edits in place", async () => {
  const calls = [];
  let item = null;
  const run = async (args) => {
    const templateArg = args.find((arg) => arg.startsWith("--template="));
    const templatePath = templateArg?.slice("--template=".length);
    const input = templatePath ? readFileSync(templatePath, "utf8") : undefined;
    if (templatePath) assert.equal(statSync(templatePath).mode & 0o077, 0, "template file must be private");
    calls.push({ args, input, templatePath });
    if (args[1] === "get") {
      if (!item) throw new Error('"YNAB MCP hosted smoke token" isn\'t an item in the "Development" vault');
      return JSON.stringify(item);
    }
    if (args[1] === "create") {
      const template = JSON.parse(input);
      item = { id: "item123", ...template };
      return "";
    }
    item = JSON.parse(input);
    return "";
  };
  const store = createOpTokenStore({ run });
  assert.equal(await store.read(), null);

  assert.equal(await store.save({ refreshToken: "rt-secret-1", clientId: "client-1", mcpUrl: "https://h.example/mcp", consentedAt: "2026-10-25T00:00:00.000Z" }), "created");
  const created = calls.find((call) => call.args[1] === "create");
  assert.deepEqual(created.args.slice(0, 3), ["item", "create", "--vault=Development"]);
  assert.match(created.args[3], /^--template=.*item\.json$/);
  assert.equal(JSON.parse(created.input).category, "API_CREDENTIAL");

  assert.equal(await store.save({ refreshToken: "rt-secret-2" }), "updated");
  assert.deepEqual(await store.read(), { refreshToken: "rt-secret-2", clientId: "client-1", mcpUrl: "https://h.example/mcp", consentedAt: "2026-10-25T00:00:00.000Z" });
  for (const call of calls) {
    assert.ok(!call.args.join(" ").includes("rt-secret"), "secrets must stay out of argv");
    if (call.templatePath) assert.throws(() => statSync(call.templatePath), "template file must be removed");
  }
});
