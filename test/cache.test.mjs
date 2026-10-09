import { test } from "node:test";
import assert from "node:assert/strict";
import { createEntityCache } from "../lib/entity-cache.mjs";
import { projectCollection } from "../lib/field-projections.mjs";

process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
process.env.YNAB_RATE_LIMIT_PER_HOUR = "0";
process.env.YNAB_HTTP_RETRIES = "0";
delete process.env.YNAB_API_TOKEN;
const { createYnabServer } = await import("../index.js");

const txn = (id, date = "2026-01-01", extra = {}) => ({ id, date, amount: -1000, approved: true, deleted: false, account_id: "a", memo: "synthetic fixture", subtransactions: [], ...extra });
const response = (data) => new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } });
const output = async (instance, tool, args = {}) => {
  const result = await instance.internals.invokeRegisteredTool(tool, args);
  assert.notEqual(result.isError, true, `${tool}: ${result.content?.[0]?.text}`);
  return JSON.parse(result.content[0].text);
};
const instance = (fetchImpl, options = {}) => createYnabServer({ hasCredentials: true, getAccessToken: async () => "fake-token", defaultBudgetId: "fake-budget", fetchImpl, ...options });

test("cache isolates tenants, sessions and budgets even when IDs match", async () => {
  const a = createEntityCache({ tenantId: "tenant-a", sessionId: "s" });
  const b = createEntityCache({ tenantId: "tenant-b", sessionId: "s" });
  const c = createEntityCache({ tenantId: "tenant-a", sessionId: "s2" });
  const read = (cache, budgetId, name) => cache.read({ budgetId, resource: "payees", load: async () => ({ payees: [{ id: "same-id", name }], server_knowledge: 1 }) });
  assert.equal((await read(a, "budget1", "a")).payees[0].name, "a");
  assert.equal((await read(b, "budget1", "b")).payees[0].name, "b");
  assert.equal((await read(c, "budget1", "c")).payees[0].name, "c");
  assert.equal((await read(a, "budget2", "other-budget")).payees[0].name, "other-budget");
  assert.equal((await read(a, "budget1", "ignored")).payees[0].name, "a");
});

test("TTL hits clone rows; expired automatic deltas merge updates and tombstones", async () => {
  let clock = 1000;
  const cache = createEntityCache({ ttlMs: 100, now: () => clock });
  const cursors = [];
  const load = async (cursor) => {
    cursors.push(cursor);
    return cursor === undefined
      ? { transactions: [txn("old", "2004-01-01"), txn("remove"), txn("change")], server_knowledge: 4 }
      : { transactions: [txn("remove", "2026-01-01", { deleted: true }), txn("change", "2026-01-01", { amount: -9000 }), txn("new", "2025-01-01")], server_knowledge: 5 };
  };
  const first = await cache.read({ budgetId: "b", resource: "transactions", load });
  first.transactions[0].memo = "caller mutation";
  clock += 50;
  const hit = await cache.read({ budgetId: "b", resource: "transactions", load });
  assert.equal(hit.freshness.source, "cache");
  assert.equal(hit.freshness.age_ms, 50);
  assert.equal(hit.transactions[0].memo, "synthetic fixture");
  clock += 51;
  const refreshed = await cache.read({ budgetId: "b", resource: "transactions", load });
  assert.deepEqual(cursors, [undefined, 4]);
  assert.deepEqual(refreshed.transactions.map((row) => row.id), ["old", "new", "change"]);
  assert.equal(refreshed.transactions[2].amount, -9000);
  assert.equal(refreshed.freshness.tombstones_removed, 1);
  assert.equal(refreshed.freshness.complete, true);
});

test("cursor resets replace baseline instead of silently retaining deleted history", async () => {
  const cache = createEntityCache({ ttlMs: 0 });
  const cursors = [];
  const replies = [
    { transactions: [txn("obsolete")], server_knowledge: 10 },
    { transactions: [txn("delta-on-new-timeline")], server_knowledge: 2 },
    { transactions: [txn("fresh-history", "2001-01-01")], server_knowledge: 3 },
  ];
  const load = async (cursor) => { cursors.push(cursor); return replies.shift(); };
  await cache.read({ budgetId: "b", resource: "transactions", load });
  const reset = await cache.read({ budgetId: "b", resource: "transactions", load });
  assert.deepEqual(cursors, [undefined, 10, undefined]);
  assert.deepEqual(reset.transactions.map((row) => row.id), ["fresh-history"]);
  assert.equal(reset.freshness.refresh, "cursor_reset");
});

test("missing delta cursor forces a full baseline and errors cannot poison stored state", async () => {
  const cache = createEntityCache({ ttlMs: 0 });
  await cache.read({ budgetId: "b", resource: "payees", load: async () => ({ payees: [{ id: "p", name: "Original" }], server_knowledge: 9 }) });
  let calls = 0;
  const result = await cache.read({ budgetId: "b", resource: "payees", load: async (cursor) => {
    calls += 1;
    return cursor === undefined ? { payees: [{ id: "new", name: "Reset" }], server_knowledge: 1 } : { payees: [] };
  } });
  assert.equal(calls, 2);
  assert.equal(result.payees[0].id, "new");
  await assert.rejects(cache.read({ budgetId: "b", resource: "payees", load: async () => { throw new Error("offline"); } }), /offline/);
  assert.equal(cache.size, 1);
});

test("category deltas preserve unchanged children, handle child tombstones and group moves", async () => {
  const cache = createEntityCache({ ttlMs: 0 });
  await cache.read({ budgetId: "b", resource: "category_groups", load: async () => ({ category_groups: [{ id: "g1", categories: [{ id: "keep" }, { id: "move" }, { id: "delete" }] }, { id: "g2", categories: [] }], server_knowledge: 1 }) });
  const result = await cache.read({ budgetId: "b", resource: "category_groups", load: async () => ({ category_groups: [{ id: "g1", categories: [{ id: "delete", deleted: true }] }, { id: "g2", categories: [{ id: "move", name: "Moved" }] }], server_knowledge: 2 }) });
  assert.deepEqual(result.category_groups[0].categories.map((c) => c.id), ["keep"]);
  assert.deepEqual(result.category_groups[1].categories.map((c) => c.id), ["move"]);
});

test("write invalidation discards in-flight read results and bounds cache entries", async () => {
  const cache = createEntityCache({ maxEntries: 2 });
  let finish;
  const reading = cache.read({ budgetId: "b", resource: "payees", load: () => new Promise((resolve) => { finish = resolve; }) });
  cache.invalidate();
  finish({ payees: [{ id: "stale" }], server_knowledge: 1 });
  const invalidated = await reading;
  assert.equal(invalidated.freshness.invalidated_during_read, true);
  assert.equal(invalidated.freshness.complete, false);
  assert.equal(cache.size, 0);
  for (const budgetId of ["1", "2", "3"]) await cache.read({ budgetId, resource: "payees", load: async () => ({ payees: [] }) });
  assert.equal(cache.size, 2);
});

test("byte budget returns complete oversized history without retaining it", async () => {
  const cache = createEntityCache({ maxBytes: 8 });
  const result = await cache.read({ budgetId: "b", resource: "transactions", load: async () => ({ transactions: [txn("oversized")], server_knowledge: 1 }) });
  assert.equal(result.transactions.length, 1);
  assert.equal(result.freshness.complete, true);
  assert.equal(result.freshness.cache_stored, false);
  assert.equal(cache.size, 0);
  assert.throws(() => createEntityCache({ maxEntries: -1 }), /positive integer/);
});

test("lean projections retain financial values, transfer/match links and split child IDs", () => {
  const raw = { ...txn("split"), amount: -1, matched_transaction_id: "match", transfer_transaction_id: "transfer", import_payee_name_original: "bank text", subtransactions: [{ id: "child", amount: -1, category_id: "c", memo: "private memo" }] };
  const lean = projectCollection([raw], "transactions", "lean")[0];
  assert.equal(lean.amount, -1);
  assert.equal(lean.matched_transaction_id, "match");
  assert.equal(lean.transfer_transaction_id, "transfer");
  assert.equal(lean.subtransactions[0].id, "child");
  assert.equal(lean.subtransactions[0].amount, -1);
  assert.equal("memo" in lean, false);
  assert.equal("memo" in lean.subtransactions[0], false);
  assert.deepEqual(projectCollection([raw], "transactions", "full"), [raw]);
});

test("transaction cached reads seed historical coverage before a recent narrow request", async () => {
  const requests = [];
  const server = instance(async (url) => {
    requests.push(new URL(url));
    return response({ transactions: [txn("old", "2005-01-01"), txn("recent", "2026-02-01")], server_knowledge: 7 });
  });
  const recent = await output(server, "get_transactions", { sinceDate: "2026-01-01", freshness: "cached", projection: "lean" });
  assert.deepEqual(recent.transactions.map((row) => row.id), ["recent"]);
  assert.equal(requests[0].searchParams.get("since_date"), "1970-01-01");
  assert.equal(requests[0].searchParams.has("last_knowledge_of_server"), false);
  const old = await output(server, "get_transactions", { sinceDate: "2000-01-01", untilDate: "2010-01-01", freshness: "cached" });
  assert.deepEqual(old.transactions.map((row) => row.id), ["old"]);
  assert.equal(old.freshness.source, "cache");
  assert.equal(old.freshness.coverage.kind, "history_since");
  assert.equal(requests.length, 1);
});

test("caller deltas never seed/overwrite merged cache and have explicit incomplete metadata", async () => {
  const requests = [];
  const server = instance(async (url) => {
    const parsed = new URL(url); requests.push(parsed);
    return response({ transactions: parsed.searchParams.has("last_knowledge_of_server") ? [txn("delta")] : [txn("old", "2000-01-01"), txn("recent")], server_knowledge: 10 });
  });
  const delta = await output(server, "get_transactions", { freshness: "cached", lastKnowledgeOfServer: 9 });
  assert.equal(delta.freshness.complete, false);
  assert.equal(delta.freshness.coverage.kind, "caller_delta");
  assert.equal(server.internals.entityCache.size, 0);
  const full = await output(server, "get_transactions", { freshness: "cached" });
  assert.deepEqual(full.transactions.map((row) => row.id), ["old", "recent"]);
  assert.equal(requests.length, 2);
});

test("cached resource scopes and month coverage cannot silently reuse another endpoint", async () => {
  const paths = [];
  const server = instance(async (url) => { const u = new URL(url); paths.push(u.pathname); return response({ transactions: [txn(u.pathname)], server_knowledge: 1 }); });
  await output(server, "get_transactions", { accountId: "a", freshness: "cached" });
  await output(server, "get_transactions", { accountId: "b", freshness: "cached" });
  const month = await output(server, "get_transactions", { month: "2026-02-01", freshness: "cached" });
  assert.equal(paths.length, 3);
  assert.equal(month.freshness.coverage.kind, "month");
  assert.equal(month.freshness.coverage.until_date, "2026-02-28");
});

test("read lists share lean/full/freshness options, cached hits and fresh bypass", async () => {
  const collections = {
    accounts: [{ id: "a", name: "Fake checking", type: "checking", balance: 9000, note: "detail", deleted: false }],
    categories: [{ id: "g", name: "Fake group", categories: [{ id: "c", name: "Fake category", budgeted: 1000, balance: 1000, note: "detail", goal_target: 4000, deleted: false }] }],
    payees: [{ id: "p", name: "Fake merchant", deleted: false }],
    scheduled_transactions: [{ id: "s", date_first: "2026-01-01", date_next: "2026-02-01", frequency: "monthly", amount: -1000, memo: "detail", subtransactions: [], deleted: false }],
  };
  let calls = 0;
  const server = instance(async (url) => { calls += 1; const key = new URL(url).pathname.split("/").at(-1); return response({ [key === "categories" ? "category_groups" : key]: collections[key], server_knowledge: 2 }); });
  for (const [tool, key] of [["list_accounts", "accounts"], ["list_categories", "category_groups"], ["list_payees", "payees"], ["list_scheduled_transactions", "scheduled_transactions"]]) {
    const lean = await output(server, tool, { freshness: "cached", projection: "lean" });
    assert.equal(lean.freshness.complete, true);
    assert.equal(lean[key].length, 1);
    const full = await output(server, tool, { freshness: "cached", projection: "full" });
    assert.equal(full.freshness.source, "cache");
    const fresh = await output(server, tool, { includeFreshness: true });
    assert.equal(fresh.freshness.source, "network");
    if (key === "accounts") { assert.equal(lean.accounts[0].balance, 9); assert.equal("note" in lean.accounts[0], false); assert.equal(full.accounts[0].note, "detail"); }
    if (key === "category_groups") { assert.equal("goal_target" in lean.category_groups[0].categories[0], false); assert.equal(full.category_groups[0].categories[0].goal_target, 4); }
  }
  assert.equal(calls, 8);
});

test("all write attempts invalidate cache, including applied-write network timeout", async () => {
  let version = 1;
  let gets = 0;
  const server = instance(async (_url, init) => {
    if ((init.method || "GET") !== "GET") { version = 2; throw new Error("synthetic applied-write timeout"); }
    gets += 1; return response({ transactions: [txn("row", "2026-01-01", { amount: -version * 1000 })], server_knowledge: version });
  });
  await output(server, "get_transactions", { freshness: "cached" });
  assert.equal(server.internals.entityCache.size, 1);
  await assert.rejects(server.internals.secureFetch("https://api.ynab.com/v1/plans/fake-budget/transactions/row", { method: "PATCH", body: "{}" }), /applied-write timeout/);
  assert.equal(server.internals.entityCache.size, 0);
  const reread = await output(server, "get_transactions", { freshness: "cached" });
  assert.equal(reread.transactions[0].amount, -2);
  assert.equal(gets, 2);
});

test("fresh transaction reads always bypass cache; token rotation expires cached principal data", async () => {
  let token = "fake-a";
  let calls = 0;
  const server = instance(async (_url, init) => { calls += 1; return response({ transactions: [txn(init.headers.get("Authorization"))], server_knowledge: calls }); }, { getAccessToken: async () => token });
  await output(server, "get_transactions", { freshness: "cached" });
  await output(server, "get_transactions", {});
  assert.equal(calls, 2);
  token = "fake-b";
  const rotated = await output(server, "get_transactions", { freshness: "cached" });
  assert.equal(rotated.transactions[0].id, "Bearer fake-b");
  assert.equal(rotated.freshness.source, "network");
  assert.equal(calls, 3);
});

test("cached search matches full rows before applying lean output projection", async () => {
  const server = instance(async () => response({ transactions: [txn("match", "2003-01-01", { memo: "fictitious needle" })], server_knowledge: 1 }));
  const found = await output(server, "search_transactions", { query: "needle", freshness: "cached", projection: "lean" });
  assert.equal(found.transactions[0].id, "match");
  assert.equal("memo" in found.transactions[0], false);
  assert.equal(found.freshness.complete, true);
});

test("automatic HTTP deltas merge old history, remove tombstones and replace reset cursors", async () => {
  const cursors = [];
  const replies = [
    { transactions: [txn("old", "2002-01-01"), txn("remove")], server_knowledge: 8 },
    { transactions: [txn("remove", "2026-01-01", { deleted: true }), txn("new")], server_knowledge: 9 },
    { transactions: [], server_knowledge: 1 },
    { transactions: [txn("reset", "2000-01-01")], server_knowledge: 2 },
  ];
  const server = instance(async (url) => { cursors.push(new URL(url).searchParams.get("last_knowledge_of_server")); return response(replies.shift()); }, { cacheTtlMs: 0 });
  await output(server, "get_transactions", { freshness: "cached" });
  const merged = await output(server, "get_transactions", { freshness: "cached" });
  assert.deepEqual(merged.transactions.map((row) => row.id), ["old", "new"]);
  assert.equal(merged.freshness.refresh, "delta_merge");
  const reset = await output(server, "get_transactions", { freshness: "cached" });
  assert.deepEqual(reset.transactions.map((row) => row.id), ["reset"]);
  assert.equal(reset.freshness.refresh, "cursor_reset");
  assert.deepEqual(cursors, [null, "8", "9", null]);
});

test("scoped and type cache expiration removes rows moved out of filter without trusting deltas", async () => {
  const calls = [];
  const server = instance(async (url) => { const u = new URL(url); calls.push(u); return response({ transactions: calls.length % 2 ? [txn("formerly-matching")] : [], server_knowledge: calls.length }); }, { cacheTtlMs: 0 });
  for (const filter of [{ accountId: "a" }, { categoryId: "c" }, { payeeId: "p" }, { month: "2026-01-01" }, { type: "uncategorized" }]) {
    const first = await output(server, "get_transactions", { ...filter, freshness: "cached" });
    assert.equal(first.transactions.length, 1);
    const changed = await output(server, "get_transactions", { ...filter, freshness: "cached" });
    assert.equal(changed.transactions.length, 0);
    assert.equal(changed.freshness.refresh, "scoped_full_refresh");
  }
  assert.equal(calls.every((url) => !url.searchParams.has("last_knowledge_of_server")), true);
  assert.equal(calls.at(-1).searchParams.get("type"), "uncategorized");
});

test("server instances cannot share cache data through identical authenticated IDs", async () => {
  const options = { tenantId: "synthetic-tenant", sessionId: "synthetic-session" };
  const a = instance(async () => response({ transactions: [txn("instance-a")], server_knowledge: 1 }), options);
  const b = instance(async () => response({ transactions: [txn("instance-b")], server_knowledge: 1 }), options);
  assert.equal((await output(a, "get_transactions", { freshness: "cached" })).transactions[0].id, "instance-a");
  assert.equal((await output(b, "get_transactions", { freshness: "cached" })).transactions[0].id, "instance-b");
});

test("expired refresh fails visibly instead of returning stale cached rows", async () => {
  let offline = false;
  const server = instance(async () => { if (offline) throw new Error("synthetic offline"); return response({ transactions: [txn("old")], server_knowledge: 1 }); }, { cacheTtlMs: 0 });
  await output(server, "get_transactions", { freshness: "cached" });
  offline = true;
  const failed = await server.internals.invokeRegisteredTool("get_transactions", { freshness: "cached" });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /synthetic offline/);
});

test("dynamic last-used budget aliases cannot reuse another budget's cached history", async () => {
  let calls = 0;
  const server = instance(async (url) => { calls += 1; assert.equal(new URL(url).searchParams.get("since_date"), "1970-01-01"); return response({ transactions: [txn(`budget-${calls}`)], server_knowledge: calls }); }, { defaultBudgetId: undefined });
  const a = await output(server, "get_transactions", { freshness: "cached" });
  const b = await output(server, "get_transactions", { freshness: "cached" });
  assert.equal(a.transactions[0].id, "budget-1");
  assert.equal(b.transactions[0].id, "budget-2");
  assert.equal(b.freshness.refresh, "dynamic_budget_alias");
  assert.equal(b.freshness.cache_stored, false);
  assert.equal(server.internals.entityCache.size, 0);
});

test("older requested coverage expands a recent baseline and keeps that boundary for deltas, tombstones and resets", async () => {
  const requests = [];
  let knowledge = 10;
  let rows = [txn("1960-row", "1960-01-01", { knowledge: 1 }), txn("recent", "2026-01-01", { knowledge: 10 })];
  const server = instance(async (url) => {
    const u = new URL(url); requests.push(u);
    const since = u.searchParams.get("since_date");
    const cursor = Number(u.searchParams.get("last_knowledge_of_server") || 0);
    return response({ transactions: rows.filter((row) => row.date >= since && (!cursor || row.knowledge > cursor)), server_knowledge: knowledge });
  }, { cacheTtlMs: 0 });
  const recent = await output(server, "get_transactions", { sinceDate: "2026-01-01", freshness: "cached" });
  assert.equal(recent.freshness.coverage.since_date, "1970-01-01");
  const old = await output(server, "get_transactions", { sinceDate: "1960-01-01", untilDate: "1969-12-31", freshness: "cached" });
  assert.deepEqual(old.transactions.map((row) => row.id), ["1960-row"]);
  assert.equal(old.freshness.coverage.kind, "history_since");
  assert.equal(old.freshness.coverage.since_date, "1960-01-01");
  assert.equal(old.freshness.refresh, "coverage_expansion");
  rows[0] = { ...rows[0], deleted: true, knowledge: 11 }; knowledge = 11;
  const merged = await output(server, "get_transactions", { sinceDate: "2026-01-01", freshness: "cached" });
  assert.equal(merged.freshness.coverage.since_date, "1960-01-01");
  assert.equal(merged.freshness.tombstones_removed, 1);
  knowledge = 1;
  rows = [txn("reset-1962", "1962-01-01", { knowledge: 1 })];
  const reset = await output(server, "get_transactions", { sinceDate: "1960-01-01", freshness: "cached" });
  assert.deepEqual(reset.transactions.map((row) => row.id), ["reset-1962"]);
  assert.equal(reset.freshness.coverage.since_date, "1960-01-01");
  assert.equal(reset.freshness.refresh, "cursor_reset");
  assert.deepEqual(requests.map((u) => [u.searchParams.get("since_date"), u.searchParams.get("last_knowledge_of_server")]), [["1970-01-01", null], ["1960-01-01", null], ["1960-01-01", "10"], ["1960-01-01", "11"], ["1960-01-01", null]]);
});

test("older coverage expands before a TTL hit and concurrent narrow reads cannot mask it", async () => {
  const cache = createEntityCache();
  let finish;
  const calls = [];
  const load = (cursor, coverage) => {
    calls.push([cursor, coverage.since_date]);
    if (calls.length === 1) return new Promise((resolve) => { finish = resolve; });
    return { transactions: [txn("1960-row", "1960-01-01"), txn("recent")], server_knowledge: 5 };
  };
  const narrow = cache.read({ budgetId: "b", resource: "transactions", coverage: { kind: "history_since", since_date: "1970-01-01" }, load });
  const older = cache.read({ budgetId: "b", resource: "transactions", coverage: { kind: "history_since", since_date: "1960-01-01" }, load });
  finish({ transactions: [txn("recent")], server_knowledge: 4 });
  await narrow;
  const expanded = await older;
  assert.equal(expanded.freshness.refresh, "coverage_expansion");
  assert.equal(expanded.transactions[0].id, "1960-row");
  const recentAgain = await cache.read({ budgetId: "b", resource: "transactions", coverage: { kind: "history_since", since_date: "1970-01-01" }, load });
  assert.equal(recentAgain.freshness.coverage.since_date, "1960-01-01");
  assert.deepEqual(calls, [[undefined, "1970-01-01"], [undefined, "1960-01-01"]]);
});
