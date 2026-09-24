import { test } from "node:test";
import assert from "node:assert/strict";
process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
process.env.YNAB_RATE_LIMIT_PER_HOUR = "0";
process.env.YNAB_HTTP_RETRIES = "0";
const { createYnabServer } = await import("../index.js");
function fixture(t, reply, settingsStatus = 200) {
  const instance = createYnabServer({ hasCredentials: true, writesEnabled: false, getAccessToken: async () => "fixture-secret", defaultBudgetId: "plan-1" });
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requests.push({ path: new URL(url).pathname, method: init.method });
    assert.equal(init.method, "GET");
    if (new URL(url).pathname.endsWith("/settings")) return settingsStatus === 200 ? response(200, { data: { settings: {} } }) : error(settingsStatus);
    return reply(String(url));
  };
  t.after(() => { globalThis.fetch = original; });
  return { instance, requests, call: (args) => instance.internals.invokeRegisteredTool("resolve_matched_transactions", instance.internals.parseToolExecuteInput("resolve_matched_transactions", args)) };
}
function response(status, body) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }
function error(status, name = "resource_not_found") { return response(status, { error: { id: String(status), name, detail: `fixture ${name}` } }); }
test("resolves mixed links once each, retains exact IDs, and formats found rows", async (t) => {
  const { call, requests } = fixture(t, url => url.endsWith("/missing") ? error(404) : response(200, { data: { transaction: { id: "live_2026-09-24", amount: -12340, payee_name: "B&amp;H", account_id: "a1", deleted: false } } }));
  const result = await call({ matchedTransactionIds: ["missing", "live_2026-09-24", "missing"] });
  assert.ok(result, "resolver registered");
  assert.equal(result.isError ?? false, false);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.results.length, 2);
  assert.deepEqual(data.results[0], { matched_transaction_id: "missing", status: "orphan" });
  assert.equal(data.results[1].status, "found");
  assert.equal(data.results[1].transaction.amount, -12.34);
  assert.equal(data.results[1].transaction.payee_name, "B&H");
  assert.equal(requests.length, 3);
  assert.ok(requests[2].path.endsWith("/live_2026-09-24"));
});
for (const [status, name] of [[401,"not_authorized"], [403,"forbidden"], [429,"too_many_requests"], [503,"service_unavailable"], [404,"other_error"]]) {
  test(`surfaces ${status} ${name} without false orphan results`, async (t) => {
    const { call } = fixture(t, () => error(status, name));
    const result = await call({ matchedTransactionIds: ["missing"] });
    assert.ok(result, "resolver registered");
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, new RegExp(name));
    assert.doesNotMatch(result.content[0].text, /"orphan"/);
  });
}
test("budget lookup errors prevent transaction orphan classification", async (t) => {
  const { call, requests } = fixture(t, () => { throw new Error("unexpected transaction lookup"); }, 404);
  const result = await call({ matchedTransactionIds: ["missing"] });
  assert.ok(result, "resolver registered");
  assert.equal(result.isError, true);
  assert.equal(requests.length, 1);
  assert.ok(requests[0].path.endsWith("/settings"));
});
test("network failures redact credentials and remain errors", async (t) => {
  const { call } = fixture(t, () => { throw new Error("network fixture-secret"); });
  const result = await call({ matchedTransactionIds: ["missing"] });
  assert.ok(result, "resolver registered");
  assert.equal(result.isError, true);
  assert.doesNotMatch(result.content[0].text, /fixture-secret/);
});
test("resolver validates nonempty bounded IDs before requests", async (t) => {
  const { call, requests } = fixture(t, () => { throw new Error("unexpected request"); });
  for (const matchedTransactionIds of [[], [""], ["   "], ["."], [".."], Array(51).fill("a")]) {
    await assert.rejects(async () => call({ matchedTransactionIds }), /Invalid input/);
  }
  assert.equal(requests.length, 0);
});
test("missing credentials block the resolver", async () => {
  const instance = createYnabServer({ hasCredentials: false });
  const result = await instance.internals.invokeRegisteredTool("resolve_matched_transactions", { matchedTransactionIds: ["a"] });
  assert.ok(result, "resolver registered");
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /missing_credentials/);
});

test("does not mistake a successful but malformed payload for a found row", async (t) => {
  const { call } = fixture(t, () => response(200, { data: {} }));
  const result = await call({ matchedTransactionIds: ["a"] });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /no matched transaction/);
});
test("unstructured 404 does not become an orphan", async (t) => {
  const { call } = fixture(t, () => new Response("not found", { status: 404 }));
  const result = await call({ matchedTransactionIds: ["a"] });
  assert.equal(result.isError, true);
});
test("later API error aborts a batch rather than returning a successful partial result", async (t) => {
  const { call, requests } = fixture(t, url => url.endsWith("/first") ? error(404) : error(429, "too_many_requests"));
  const result = await call({ budgetId: "plan-2", matchedTransactionIds: ["first", "second", "third"] });
  assert.equal(result.isError, true);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(r => r.path.startsWith("/v1/plans/plan-2/")));
  assert.doesNotMatch(result.content[0].text, /"orphan"/);
});
test("default budget guidance remains in initialize instructions", () => {
  const instance = createYnabServer({ hasCredentials: false });
  assert.match(instance.server.server._instructions, /Omit budgetId to use the default budget/);
});

test("a returned deleted row remains found with its deletion flag", async (t) => {
  const { call } = fixture(t, () => response(200, { data: { transaction: { id: "gone", amount: 0, deleted: true } } }));
  const result = await call({ matchedTransactionIds: ["gone"] });
  const row = JSON.parse(result.content[0].text).results[0];
  assert.equal(row.status, "found");
  assert.equal(row.transaction.deleted, true);
});
test("actual MCP transport validates the read-only resolver schema and returns structured results", async (t) => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { instance, requests } = fixture(t, () => error(404));
  const client = new Client({ name: "resolver-fixture", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await instance.server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await instance.server.close(); });
  const tools = (await client.listTools()).tools;
  assert.equal(tools.find(tool => tool.name === "resolve_matched_transactions").annotations.readOnlyHint, true);
  assert.ok(!tools.some(tool => tool.name === "delete_transaction"));
  const invalid = await client.callTool({ name: "resolve_matched_transactions", arguments: { matchedTransactionIds: [] } });
  assert.equal(invalid.isError, true);
  assert.equal(requests.length, 0);
  const result = await client.callTool({ name: "resolve_matched_transactions", arguments: { matchedTransactionIds: ["missing"] } });
  assert.deepEqual(result.structuredContent.result.results, [{ matched_transaction_id: "missing", status: "orphan" }]);
});
