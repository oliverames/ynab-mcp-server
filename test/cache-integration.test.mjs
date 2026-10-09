import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpHarness, assertToolOk } from "./support/mcp-harness.mjs";
import { FakeYnabHttpServer } from "./support/fake-ynab.mjs";

test("MCP cached date windows retain old history from one complete HTTP baseline", async (t) => {
  const h = await createMcpHarness(); t.after(() => h.close());
  const recent = assertToolOk(await h.call("get_transactions", { sinceDate: "2026-01-01", freshness: "cached", projection: "lean" }));
  assert.equal(recent.transactions.some((row) => row.id === "fake-old"), false);
  const old = assertToolOk(await h.call("get_transactions", { sinceDate: "2010-01-01", untilDate: "2020-01-01", freshness: "cached" }));
  assert.deepEqual(old.transactions.map((row) => row.id), ["fake-old"]);
  assert.equal(old.transactions[0].amount, -9);
  assert.equal(old.freshness.source, "cache");
  assert.equal(old.freshness.coverage.since_date, "1970-01-01");
  const reads = h.fake.requests.filter((request) => request.path.endsWith("/transactions"));
  assert.equal(reads.length, 1);
  assert.equal(reads[0].query.since_date, "1970-01-01");
  assert.equal(h.fake.writes().length, 0);
});

test("MCP TTL refresh merges HTTP deltas, tombstones and cursor reset full history", async (t) => {
  const h = await createMcpHarness({ cacheTtlMs: 0 }); t.after(() => h.close());
  assertToolOk(await h.call("get_transactions", { freshness: "cached" }));
  h.fake.mutateTransaction("fake-import", { amount: -24000 });
  h.fake.mutateTransaction("fake-old", { deleted: true });
  const merged = assertToolOk(await h.call("get_transactions", { freshness: "cached" }));
  assert.equal(merged.transactions.some((row) => row.id === "fake-old"), false);
  assert.equal(merged.transactions.find((row) => row.id === "fake-import").amount, -24);
  assert.equal(merged.transactions.some((row) => row.id === "fake-uncertain"), true);
  assert.equal(merged.freshness.refresh, "delta_merge");
  assert.equal(merged.freshness.tombstones_removed, 1);
  const budget = h.fake.budget();
  budget.server_knowledge = 1;
  budget.transactions = budget.transactions.filter((row) => row.id === "fake-import");
  budget.transactions[0]._knowledge = 1;
  const reset = assertToolOk(await h.call("get_transactions", { freshness: "cached" }));
  assert.deepEqual(reset.transactions.map((row) => row.id), ["fake-import"]);
  assert.equal(reset.freshness.refresh, "cursor_reset");
  const cursors = h.fake.requests.filter((request) => request.path.endsWith("/transactions")).map((request) => request.query.last_knowledge_of_server ?? null);
  assert.deepEqual(cursors, [null, "10", "12", null]);
});

test("MCP cached sessions and tenants with shared entity IDs retain separate budgets", async (t) => {
  const fake = await new FakeYnabHttpServer().start(); t.after(() => fake.close());
  const a = await createMcpHarness({ fake }); t.after(() => a.close());
  const b = await createMcpHarness({ fake, token: "fake-token-b", sessionId: "fake-session-b" }); t.after(() => b.close());
  const rowsA = assertToolOk(await a.call("get_transactions", { freshness: "cached" }));
  const rowsB = assertToolOk(await b.call("get_transactions", { freshness: "cached" }));
  assert.match(rowsA.transactions[0].account_name, /checking a/);
  assert.match(rowsB.transactions[0].account_name, /checking b/);
  assert.equal((await b.call("get_transactions", { budgetId: "fake-budget-a", freshness: "cached" })).isError, true);
  const repeat = assertToolOk(await b.call("get_transactions", { freshness: "cached" }));
  assert.match(repeat.transactions[0].account_name, /checking b/);
  assert.equal(repeat.freshness.source, "cache");
});

test("MCP previews read freshly and real writes invalidate a retained stale cache", async (t) => {
  const h = await createMcpHarness(); t.after(() => h.close());
  assertToolOk(await h.call("get_transactions", { freshness: "cached" }));
  h.fake.mutateTransaction("fake-import", { amount: -25000 });
  const args = { transactionId: "fake-import", memo: "Synthetic approved cache integration" };
  const { previewToken } = await h.preview("update_transaction", args);
  assert.equal(h.instance.internals.entityCache.size, 1, "capturing a preview makes no write and retains the cache");
  assert.ok(h.fake.requests.some((request) => request.method === "GET" && request.path.endsWith("/transactions/fake-import")));
  const written = assertToolOk(await h.call("update_transaction", { ...args, previewToken, confirmed: true }));
  assert.equal(written.amount, -25);
  assert.equal(h.instance.internals.entityCache.size, 0);
  const fresh = assertToolOk(await h.call("get_transactions", { freshness: "cached" }));
  assert.equal(fresh.freshness.source, "network");
  const row = fresh.transactions.find((item) => item.id === "fake-import");
  assert.equal(row.amount, -25);
  assert.equal(row.memo, args.memo);
  assert.equal(h.fake.writes().length, 1);
});

test("MCP applied-write response disconnect clears cache without replaying the write", async (t) => {
  const h = await createMcpHarness(); t.after(() => h.close());
  assertToolOk(await h.call("get_transactions", { freshness: "cached" }));
  const args = { transactionId: "fake-import", memo: "Synthetic applied cache timeout" };
  const { previewToken } = await h.preview("update_transaction", args);
  h.fake.injectFault({ method: "PUT", path: "/transactions/fake-import", afterApply: true, mode: "body-disconnect" });
  await h.call("update_transaction", { ...args, previewToken, confirmed: true });
  assert.equal(h.instance.internals.entityCache.size, 0);
  const reread = assertToolOk(await h.call("get_transactions", { freshness: "cached" }));
  assert.equal(reread.transactions.find((row) => row.id === "fake-import").memo, args.memo);
  assert.equal(reread.freshness.source, "network");
  assert.equal(h.fake.writes().length, 1);
});

test("MCP pre-1970 history expands a recent cache and later HTTP deltas keep its boundary", async (t) => {
  const h = await createMcpHarness({ cacheTtlMs: 0 }); t.after(() => h.close());
  h.fake.mutateTransaction("fake-old", { date: "1960-01-01" });
  const recent = assertToolOk(await h.call("get_transactions", { sinceDate: "2026-01-01", freshness: "cached" }));
  assert.equal(recent.freshness.coverage.since_date, "1970-01-01");
  const older = assertToolOk(await h.call("get_transactions", { sinceDate: "1960-01-01", untilDate: "1969-12-31", freshness: "cached" }));
  assert.deepEqual(older.transactions.map((row) => row.id), ["fake-old"]);
  assert.equal(older.freshness.refresh, "coverage_expansion");
  assert.equal(older.freshness.coverage.since_date, "1960-01-01");
  h.fake.mutateTransaction("fake-old", { deleted: true });
  const merged = assertToolOk(await h.call("get_transactions", { sinceDate: "1960-01-01", freshness: "cached" }));
  assert.equal(merged.transactions.some((row) => row.id === "fake-old"), false);
  assert.equal(merged.freshness.tombstones_removed, 1);
  assert.equal(merged.freshness.coverage.since_date, "1960-01-01");
  const requests = h.fake.requests.filter((request) => request.path.endsWith("/transactions"));
  assert.deepEqual(requests.map((request) => [request.query.since_date, request.query.last_knowledge_of_server ?? null]), [["1970-01-01", null], ["1960-01-01", null], ["1960-01-01", "11"]]);
});
