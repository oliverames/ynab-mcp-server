// Synthetic MCP -> SDK -> real loopback HTTP -> file journal recovery fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHarness, assertToolOk, toolData } from "./support/mcp-harness.mjs";
import { FakeYnabHttpServer, syntheticBudget } from "./support/fake-ynab.mjs";

// The injected timeout never responds, so a generous synthetic deadline still
// exercises production abort/reconciliation without timing out ordinary reads
// when the host is under contention.
process.env.YNAB_HTTP_TIMEOUT_MS = "5000";

const move = {
  month: "2026-10-01", fromCategoryId: "fake-food", toCategoryId: "fake-travel", amount: 10,
};
const categoryPath = (id) => `/months/2026-10-01/categories/${id}`;
const category = (fake, id) => fake.budget().month_categories["2026-10-01"].find((row) => row.id === id);

// "current" budget months resolve from the real clock, but the synthetic budget
// lives in October 2026. Pin Date to it so these tests do not expire each month.
const FIXTURE_NOW = Date.parse("2026-10-15T12:00:00Z");
const pinFixtureMonth = (t) => t.mock.timers.enable({ apis: ["Date"], now: FIXTURE_NOW });

async function partialMove(harness) {
  harness.fake.injectFault({ method: "PATCH", path: categoryPath("fake-travel"), status: 503 });
  const result = assertToolOk(await harness.write("move_category_budget", move));
  assert.equal(result.status, "partial");
  assert.equal(result.completed_steps, 1);
  assert.equal(category(harness.fake, "fake-food").budgeted, 90000);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 20000);
  assert.equal(harness.fake.writes().length, 2);
  return result;
}

test("applied destination timeout completes by fresh readback without retrying either allocation", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.injectFault({ method: "PATCH", path: categoryPath("fake-travel"), afterApply: true, mode: "timeout" });
  const result = assertToolOk(await harness.write("move_category_budget", move));
  assert.equal(result.status, "completed");
  assert.equal(result.atomic, false);
  assert.equal(result.steps[1].outcome, "applied_despite_write_error");
  assert.equal(category(harness.fake, "fake-food").budgeted, 90000);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 30000);
  const writes = harness.fake.writes();
  assert.equal(writes.length, 2);
  assert.ok(writes[0].path.endsWith(categoryPath("fake-food")));
  assert.ok(writes[1].path.endsWith(categoryPath("fake-travel")));
  assert.equal(writes[1].body.category.budgeted, 30000);
  const entry = (await harness.journal.read()).find((row) => row.type === "durable_operation");
  assert.equal(entry.status, "completed");
  assert.deepEqual(entry.steps.map((step) => step.verified_after), [{ budgeted: 90000 }, { budgeted: 30000 }]);
});

test("applied destination body-read failure also reconciles without a duplicate credit", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.injectFault({ method: "PATCH", path: categoryPath("fake-travel"), afterApply: true, mode: "body-disconnect" });
  const result = assertToolOk(await harness.write("move_category_budget", move));
  assert.equal(result.status, "completed");
  assert.equal(result.steps[1].outcome, "applied_despite_write_error");
  assert.equal(harness.fake.writes().length, 2);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 30000);
});

test("partial move persists across reconnect and resumes only after a new exact preview and explicit consent", async (t) => {
  const fake = await new FakeYnabHttpServer().start(); t.after(() => fake.close());
  const directory = await mkdtemp(join(tmpdir(), "ynab-category-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, "journal.json");
  const first = await createMcpHarness({ fake, journalPath, sessionId: "fake-original-session" });
  const result = await partialMove(first);
  const original = assertToolOk(await first.call("list_operations"));
  assert.equal(original.operations.length, 1);
  assert.equal(original.operations[0].id, result.operation_id);
  assert.equal(original.operations[0].steps[1].status, "pending");
  assert.equal(fake.writes().length, 2);
  await first.close();

  const { createFsJournal } = await import("../index.js");
  const persisted = (await createFsJournal(journalPath).read()).find((entry) => entry.id === result.operation_id);
  assert.equal(persisted.status, "partial");
  assert.equal(persisted.steps[0].verified_after.budgeted, 90000);
  const reconnected = await createMcpHarness({ fake, journalPath, sessionId: "fake-reconnected-session" });
  t.after(() => reconnected.close());
  const listed = assertToolOk(await reconnected.call("list_operations"));
  assert.equal(listed.operations[0].id, result.operation_id);
  assert.equal(fake.writes().length, 2);
  const args = { operationId: result.operation_id };
  const { previewToken } = await reconnected.preview("resume_operation", args);
  assert.equal(fake.writes().length, 2);
  assert.equal((await reconnected.call("resume_operation", { ...args, previewToken })).isError, true);
  assert.equal(fake.writes().length, 2);
  const recovered = assertToolOk(await reconnected.call("resume_operation", { ...args, previewToken, confirmed: true }));
  assert.equal(recovered.status, "completed");
  assert.equal(fake.writes().length, 3);
  assert.equal(fake.writes().filter((row) => row.path.endsWith(categoryPath("fake-food"))).length, 1);
  assert.equal(category(fake, "fake-food").budgeted, 90000);
  assert.equal(category(fake, "fake-travel").budgeted, 30000);
  const final = (await reconnected.journal.read()).find((entry) => entry.id === result.operation_id);
  assert.equal(final.session_id, "fake-original-session");
  assert.deepEqual(final.recovery_sessions, ["fake-reconnected-session"]);
});

test("stale source allocation after preview rejects execution before any financial write", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const { previewToken } = await harness.preview("move_category_budget", move);
  category(harness.fake, "fake-food").budgeted = 110000;
  const result = await harness.call("move_category_budget", { ...move, previewToken, confirmed: true });
  assert.equal(result.isError, true);
  assert.match(String(toolData(result)), /stale|changed|fingerprint|conflict/i);
  assert.equal(harness.fake.writes().length, 0);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 20000);
  assert.equal((await harness.journal.read()).length, 0);
});

test("externally edited verified source blocks partial recovery without destination credit", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = await partialMove(harness);
  category(harness.fake, "fake-food").budgeted = 95000;
  const recovered = assertToolOk(await harness.write("resume_operation", { operationId: result.operation_id }));
  assert.equal(recovered.status, "conflict");
  assert.equal(recovered.steps[0].outcome, "verified_after_changed");
  assert.equal(harness.fake.writes().length, 2);
  assert.equal(category(harness.fake, "fake-food").budgeted, 95000);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 20000);
  const repeated = assertToolOk(await harness.write("resume_operation", { operationId: result.operation_id }));
  assert.equal(repeated.status, "conflict");
  assert.equal(harness.fake.writes().length, 2);
});

test("recovery operations cannot be read or resumed through another tenant sharing the file", async (t) => {
  const fake = await new FakeYnabHttpServer().start(); t.after(() => fake.close());
  const directory = await mkdtemp(join(tmpdir(), "ynab-category-isolation-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, "journal.json");
  const first = await createMcpHarness({ fake, journalPath }); t.after(() => first.close());
  const other = await createMcpHarness({ fake, journalPath, token: "fake-token-b", sessionId: "fake-session-b" }); t.after(() => other.close());
  const partial = await partialMove(first);
  assert.deepEqual(assertToolOk(await other.call("list_operations")).operations, []);
  const preview = await other.call("preview_write_tool", { tool_name: "resume_operation", input: { operationId: partial.operation_id } });
  assert.equal(preview.isError, true);
  assert.match(String(toolData(preview)), /tenant|scope|not found/i);
  assert.equal(fake.writes().length, 2);
});

test("listing without a budget includes every budget in this tenant and explicit budget filters", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.tenants.get("fake-token-a").budgets.push(syntheticBudget("fake-budget-a-second", "a-second"));
  assertToolOk(await harness.write("move_category_budget", move));
  assertToolOk(await harness.write("move_category_budget", { ...move, budgetId: "fake-budget-a-second" }));
  const writesBefore = harness.fake.writes().length;
  const all = assertToolOk(await harness.call("list_operations"));
  assert.deepEqual(new Set(all.operations.map((entry) => entry.budget_id)), new Set(["fake-budget-a", "fake-budget-a-second"]));
  const selected = assertToolOk(await harness.call("list_operations", { budgetId: "fake-budget-a-second" }));
  assert.equal(selected.operations.length, 1);
  assert.equal(selected.operations[0].budget_id, "fake-budget-a-second");
  assert.equal(harness.fake.writes().length, writesBefore);
});

test("explicit mismatched budget rejects recovery preview without switching budgets", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = await partialMove(harness);
  const preview = await harness.call("preview_write_tool", {
    tool_name: "resume_operation", input: { operationId: result.operation_id, budgetId: "fake-other-budget" },
  });
  assert.equal(preview.isError, true);
  assert.match(String(toolData(preview)), /different budget/i);
  assert.equal(harness.fake.writes().length, 2);
});

test("corrupt and non-array file journals block multi-step writes without replacing evidence", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  for (const contents of ['{"incomplete":', '{"unexpected":"object"}']) {
    await writeFile(harness.journalPath, contents, { mode: 0o600 });
    const result = await harness.write("move_category_budget", move);
    assert.equal(result.isError, true);
    assert.equal(harness.fake.writes().length, 0);
    assert.equal(await readFile(harness.journalPath, "utf8"), contents);
    assert.equal(category(harness.fake, "fake-food").budgeted, 100000);
    assert.equal(category(harness.fake, "fake-travel").budgeted, 20000);
  }
});

test("merge moves full ordinary history plus exact allocations and reports split rows for manual action", async (t) => {
  pinFixtureMonth(t);
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const budget = harness.fake.budget();
  budget.transactions.push({
    id: "fake-split-parent", date: "2026-10-03", account_id: "fake-checking", amount: -10000,
    category_id: null, payee_id: "fake-mixed", approved: false, cleared: "uncleared", deleted: false,
    memo: "Synthetic split", _knowledge: ++budget.server_knowledge,
    subtransactions: [{ id: "fake-split-food", amount: -4000, category_id: "fake-food", deleted: false }, { id: "fake-split-travel", amount: -6000, category_id: "fake-travel", deleted: false }],
  });
  const result = assertToolOk(await harness.write("merge_category", {
    fromCategoryId: "fake-food", toCategoryId: "fake-travel", moveBudgetedMonths: "current",
  }));
  assert.equal(result.status, "completed");
  assert.equal(result.total_steps, 4);
  assert.equal(result.skipped_subtransaction_rows, 1);
  assert.equal(budget.transactions.find((row) => row.id === "fake-old").category_id, "fake-travel");
  assert.equal(budget.transactions.find((row) => row.id === "fake-import").category_id, "fake-travel");
  assert.equal(budget.transactions.find((row) => row.id === "fake-import").import_id, "FAKE:market:2026-10-01:1");
  assert.equal(budget.transactions.find((row) => row.id === "fake-split-parent").subtransactions[0].category_id, "fake-food");
  assert.equal(category(harness.fake, "fake-food").budgeted, 0);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 120000);
  assert.equal(harness.fake.writes().length, 4);
  assert.ok(harness.fake.requests.some((row) => row.path.includes("/categories/fake-food/transactions") && row.query.since_date <= "2019-01-10"));
});

test("retire recategorizes ordinary history and zeros source without crediting destination", async (t) => {
  pinFixtureMonth(t);
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = assertToolOk(await harness.write("retire_category", {
    categoryId: "fake-food", replacementCategoryId: "fake-travel", zeroBudgetedMonths: "current",
  }));
  assert.equal(result.status, "completed");
  assert.equal(result.total_steps, 3);
  assert.equal(category(harness.fake, "fake-food").budgeted, 0);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 20000);
  assert.equal(harness.fake.writes().filter((row) => row.path.endsWith(categoryPath("fake-travel"))).length, 0);
});

const batch = {
  month: "2026-10-01",
  categories: [{ categoryId: "fake-food", budgeted: 50 }, { categoryId: "fake-travel", budgeted: 30 }],
};
const previewBatch = (harness, input) => harness.call("preview_write_tool", { tool_name: "update_month_categories", input });

test("::batch applies every item with readback", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = assertToolOk(await harness.write("update_month_categories", batch));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.items, [
    { categoryId: "fake-food", before: 100, after: 50, status: "applied", outcome: "verified_applied" },
    { categoryId: "fake-travel", before: 20, after: 30, status: "applied", outcome: "verified_applied" },
  ]);
  assert.equal(category(harness.fake, "fake-food").budgeted, 50000);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 30000);
});

test("::batch preview lists current and proposed amounts", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const { data } = await harness.preview("update_month_categories", batch);
  assert.deepEqual(data.plan.before.map((row) => [row.target.categoryId, row.before.budgeted]), [["fake-food", 100000], ["fake-travel", 20000]]);
  assert.deepEqual(data.plan.intents.map((row) => [row.target.categoryId, row.after.budgeted]), [["fake-food", 50000], ["fake-travel", 30000]]);
  assert.equal(harness.fake.writes().length, 0);
});

test("::batch rejects duplicate category at preview", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = await previewBatch(harness, { ...batch, categories: [batch.categories[0], { categoryId: "fake-food", budgeted: 1 }] });
  assert.equal(result.isError, true);
  assert.match(String(toolData(result)), /duplicate.*fake-food/i);
});

test("::batch rejects unknown category at preview", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = await previewBatch(harness, { ...batch, categories: [...batch.categories, { categoryId: "fake-missing", budgeted: 1 }] });
  assert.equal(result.isError, true);
  assert.match(String(toolData(result)), /fake-missing/);
});

test("::batch rejects more than 50 items at preview", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const categories = Array.from({ length: 51 }, (_, index) => ({ categoryId: `fake-bulk-${index}`, budgeted: 1 }));
  const result = await previewBatch(harness, { ...batch, categories });
  assert.equal(result.isError, true);
  assert.match(String(toolData(result)), /Invalid input for update_month_categories/);
});

test("::batch rejects malformed month at preview", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = await previewBatch(harness, { ...batch, month: "2026-10-15" });
  assert.equal(result.isError, true);
  assert.match(String(toolData(result)), /YYYY-MM-DD format and use the first day/);
});

test("::stale batch item aborts before any write", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const { previewToken } = await harness.preview("update_month_categories", batch);
  category(harness.fake, "fake-travel").budgeted = 25000;
  const result = await harness.call("update_month_categories", { ...batch, previewToken, confirmed: true });
  assert.equal(result.isError, true);
  assert.match(String(toolData(result)), /stale/i);
  assert.equal(harness.fake.writes().length, 0);
  assert.equal((await harness.journal.read()).length, 0);
});

test("::batch stops at first failed write", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.injectFault({ method: "PATCH", path: categoryPath("fake-food"), status: 503 });
  const result = assertToolOk(await harness.write("update_month_categories", batch));
  assert.equal(result.status, "partial");
  assert.equal(result.recovery_required, true);
  assert.deepEqual(result.items.map((item) => item.status), ["pending", "pending"]);
  assert.equal(harness.fake.writes().length, 1);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 20000);
});

test("::batch final readback mismatch is a conflict", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.injectFault({ method: "PATCH", path: categoryPath("fake-food"), afterApply: true, mode: "persist-drift", persistOverride: { budgeted: 77000 } });
  const result = assertToolOk(await harness.write("update_month_categories", batch));
  assert.equal(result.status, "conflict");
  assert.equal(result.recovery_required, true);
  assert.deepEqual(result.items[0], { categoryId: "fake-food", before: 100, after: 50, status: "conflict", outcome: "final_readback_mismatch", observed: 77 });
  assert.equal(result.items[1].status, "applied");
});

test("::partial batch resumes after new approval", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.injectFault({ method: "PATCH", path: categoryPath("fake-travel"), status: 503 });
  const partial = assertToolOk(await harness.write("update_month_categories", batch));
  assert.equal(partial.status, "partial");
  assert.equal(harness.fake.writes().length, 2);
  const resumed = assertToolOk(await harness.write("resume_operation", { operationId: partial.operation_id }));
  assert.equal(resumed.status, "completed");
  assert.equal(harness.fake.writes().length, 3);
  assert.ok(harness.fake.writes()[2].path.endsWith(categoryPath("fake-travel")));
  assert.equal(category(harness.fake, "fake-food").budgeted, 50000);
  assert.equal(category(harness.fake, "fake-travel").budgeted, 30000);
});

test("::batch unchanged item is not written", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const result = assertToolOk(await harness.write("update_month_categories", { ...batch, categories: [batch.categories[0], { categoryId: "fake-travel", budgeted: 20 }] }));
  assert.equal(result.status, "completed");
  assert.deepEqual(result.items[1], { categoryId: "fake-travel", before: 20, after: 20, status: "applied", outcome: "no_change" });
  assert.equal(harness.fake.writes().length, 1);
  assert.equal(harness.fake.writes().filter((row) => row.path.endsWith(categoryPath("fake-travel"))).length, 0);
});

test("::batch uses month reads only", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.budget().month_categories["2026-10-01"].push({ id: "fake-gifts", name: "Gifts", category_group_id: "fake-living", budgeted: 5000, activity: 0, balance: 5000, deleted: false, hidden: false });
  const input = { ...batch, categories: [...batch.categories, { categoryId: "fake-gifts", budgeted: 15 }] };
  const { previewToken } = await harness.preview("update_month_categories", input);
  const start = harness.fake.requests.length;
  assertToolOk(await harness.call("update_month_categories", { ...input, previewToken, confirmed: true }));
  const requests = harness.fake.requests.slice(start);
  assert.equal(requests.filter((row) => row.method === "GET" && row.path.endsWith("/months/2026-10-01")).length, 3);
  assert.equal(requests.filter((row) => row.method === "PATCH").length, 3);
  assert.equal(requests.filter((row) => row.method === "GET" && /\/months\/2026-10-01\/categories\//.test(row.path)).length, 0);
  assert.equal(requests.length, 6);
});

test("::batch rejects deleted category at preview", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.budget().month_categories["2026-10-01"].push({ id: "fake-deleted", name: "Deleted", category_group_id: "fake-living", budgeted: 0, activity: 0, balance: 0, deleted: true, hidden: false });
  const result = await previewBatch(harness, { ...batch, categories: [...batch.categories, { categoryId: "fake-deleted", budgeted: 1 }] });
  assert.equal(result.isError, true);
  assert.match(String(toolData(result)), /fake-deleted/);
  assert.equal(harness.fake.writes().length, 0);
});

test("::batch final readback unavailable is unknown with a reason", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const { previewToken } = await harness.preview("update_month_categories", batch);
  // Execution reads the month three times: re-prepare, preflight, final readback.
  harness.fake.injectFault({ method: "GET", path: /\/months\/2026-10-01$/, status: 503, skip: 2, times: 10 });
  const result = assertToolOk(await harness.call("update_month_categories", { ...batch, previewToken, confirmed: true }));
  assert.equal(result.status, "unknown");
  assert.equal(result.outcome, "final_readback_unavailable");
  assert.equal(result.recovery_required, true);
  assert.equal(harness.fake.writes().length, 2);
});

test("::batch resume after final mismatch reports no stale mismatch", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.injectFault({ method: "PATCH", path: categoryPath("fake-food"), afterApply: true, mode: "persist-drift", persistOverride: { budgeted: 77000 } });
  const conflict = assertToolOk(await harness.write("update_month_categories", batch));
  assert.equal(conflict.status, "conflict");
  category(harness.fake, "fake-food").budgeted = 50000;
  const resumed = assertToolOk(await harness.write("resume_operation", { operationId: conflict.operation_id }));
  assert.equal(resumed.status, "completed");
  assert.equal(resumed.observed, undefined);
  assert.equal(resumed.steps[0].outcome, "after_observed_on_recovery");
  const listed = assertToolOk(await harness.call("list_operations")).operations[0];
  assert.ok(listed.steps.every((step) => step.observed === undefined && step.outcome !== "final_readback_mismatch"));
});
