import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const moduleUrl = new URL("../index.js", import.meta.url).href;

function probe(code) {
  const env = {
    ...process.env,
    YNAB_MCP_NO_AUTOSTART: "1",
    YNAB_DISABLE_AGENT_CONFIG_FALLBACK: "1",
    YNAB_API_TOKEN: "synthetic-bootstrap-token",
  };
  for (const key of ["YNAB_API_TOKEN_FILE", "YNAB_OP_PATH", "YNAB_BUDGET_ID", "YNAB_ALLOW_WRITES"]) delete env[key];
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    env, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("Worker module bootstrap never performs request-only randomness, timers, or fetch", () => {
  const result = probe(`
    import assert from "node:assert/strict";
    import crypto from "node:crypto";
    import timers from "node:timers";
    import { syncBuiltinESMExports } from "node:module";
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "Cloudflare-Workers" } });
    const calls = [];
    const originals = [];
    const block = (target, name) => {
      const original = target[name];
      originals.push(() => { target[name] = original; });
      target[name] = () => { calls.push(name); throw new Error("Request-only operation at Worker global scope: " + name); };
    };
    for (const name of ["randomUUID", "randomBytes", "randomFill", "randomFillSync"]) block(crypto, name);
    for (const name of ["randomUUID", "getRandomValues"]) block(globalThis.crypto, name);
    for (const name of ["setTimeout", "setInterval", "setImmediate"]) {
      block(globalThis, name);
      block(timers, name);
    }
    block(globalThis, "fetch");
    syncBuiltinESMExports();
    const { createYnabServer } = await import(${JSON.stringify(moduleUrl)});
    await Promise.resolve();
    assert.deepEqual(calls, [], "import must not build the unused default stdio server");
    for (const restore of originals.reverse()) restore();
    syncBuiltinESMExports();
    let tokenLookups = 0;
    const options = { tenantId: "synthetic-consent", hasCredentials: true, getAccessToken: async () => { tokenLookups++; return "synthetic-request-token"; } };
    const first = createYnabServer({ ...options, sessionId: "synthetic-session-one" });
    const second = createYnabServer({ ...options, sessionId: "synthetic-session-two" });
    assert.notEqual(first.server, second.server);
    assert.notEqual(first.internals.entityCache, second.internals.entityCache);
    const status = await first.internals.invokeRegisteredTool("ynab_auth_status", {});
    assert.equal(status.isError ?? false, false);
    assert.equal(status.structuredContent.result.authenticated, true);
    assert.equal(tokenLookups, 2, "credentials are resolved only after request-time factory construction");
    await Promise.all([first.server.close(), second.server.close()]);
    console.log(JSON.stringify({ bootstrapCalls: calls, requestInstances: 2, authenticated: true }));
  `);
  assert.deepEqual(result, { bootstrapCalls: [], requestInstances: 2, authenticated: true });
});

test("Node default stdio sessions and independent factories retain random isolation", () => {
  const code = `
    import assert from "node:assert/strict";
    import crypto from "node:crypto";
    import { syncBuiltinESMExports } from "node:module";
    const original = crypto.randomUUID;
    const generated = [];
    crypto.randomUUID = (...args) => { const id = original(...args); generated.push(id); return id; };
    syncBuiltinESMExports();
    const { createYnabServer, dollars } = await import(${JSON.stringify(moduleUrl)});
    assert.equal(dollars(-1500), -1.5, "Node helper exports retain the default instance");
    assert.equal(generated.length, 1, "the default Node instance gets a random session identity");
    const first = createYnabServer();
    const second = createYnabServer();
    assert.equal(generated.length, 5, "each independent factory gets random tenant and session identities");
    assert.equal(new Set(generated).size, generated.length);
    await Promise.all([first.server.close(), second.server.close()]);
    console.log(JSON.stringify({ defaultSession: generated[0], factoryIdentities: generated.slice(1) }));
  `;
  const first = probe(code);
  const second = probe(code);
  const identities = [first.defaultSession, ...first.factoryIdentities, second.defaultSession, ...second.factoryIdentities];
  assert.equal(identities.length, 10);
  assert.equal(new Set(identities).size, 10, "separate CLI processes must not reuse session identities");
  for (const identity of identities) assert.match(identity, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
});
