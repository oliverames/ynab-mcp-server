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
