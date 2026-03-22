import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["index.js"],
  env: { ...process.env },
});

const client = new Client({ name: "test", version: "1.0.0" });
await client.connect(transport);

const bid = "f388de30-0c03-4628-a411-cff616b26bc6";

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content[0].text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

let passed = 0;
let failed = 0;

async function test(label, fn) {
  try {
    await fn();
    console.log(`  PASS: ${label}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL: ${label} — ${e.message}`);
    failed++;
  }
}

// --- Read operations ---
console.log("\n=== Read Operations ===");

await test("get_user", async () => {
  const user = await call("get_user");
  if (!user.id) throw new Error("no user id");
});

await test("list_budgets", async () => {
  const result = await call("list_budgets");
  if (result.budgets.length === 0) throw new Error("no budgets");
});

await test("get_budget", async () => {
  const b = await call("get_budget", { budgetId: bid });
  if (!b.name) throw new Error("no budget name");
});

await test("get_budget_settings", async () => {
  const s = await call("get_budget_settings", { budgetId: bid });
  if (!s.currency_format) throw new Error("no currency format");
});

await test("list_accounts", async () => {
  const a = await call("list_accounts", { budgetId: bid });
  if (a.length === 0) throw new Error("no accounts");
  if (typeof a[0].balance !== "number") throw new Error("balance not converted to dollars");
});

let testAccountId;
await test("get_account", async () => {
  const accounts = await call("list_accounts", { budgetId: bid });
  testAccountId = accounts[0].id;
  const a = await call("get_account", { budgetId: bid, accountId: testAccountId });
  if (!a.name) throw new Error("no account name");
});

let categories;
await test("list_categories", async () => {
  categories = await call("list_categories", { budgetId: bid });
  if (categories.length === 0) throw new Error("no category groups");
});

// Build a category lookup by name (emoji name)
const catByName = {};
for (const g of categories) {
  for (const c of g.categories) {
    catByName[c.name] = c.id;
  }
}

let testCatId;
await test("get_category", async () => {
  testCatId = catByName["🥡 Eating Out"];
  if (!testCatId) throw new Error("Eating Out category not found");
  const c = await call("get_category", { budgetId: bid, categoryId: testCatId });
  if (!c.name) throw new Error("no category name");
  if (typeof c.budgeted !== "number") throw new Error("budgeted not converted to dollars");
  // Verify no raw milliunits leak — goal fields should be dollars or null
  if (c.goal_target !== null && c.goal_target !== undefined && Math.abs(c.goal_target) > 100000) {
    throw new Error("goal_target appears to be in milliunits, not dollars");
  }
});

await test("get_month_category", async () => {
  const c = await call("get_month_category", { budgetId: bid, month: "2026-03-01", categoryId: testCatId });
  if (typeof c.budgeted !== "number") throw new Error("budgeted not a number");
});

await test("update_category (update note, verify round-trip)", async () => {
  const marker = `MCP test ${Date.now()}`;
  const updated = await call("update_category", { budgetId: bid, categoryId: testCatId, note: marker });
  if (updated.note !== marker) throw new Error("note not updated");
  // Clean up — restore to null
  await call("update_category", { budgetId: bid, categoryId: testCatId, note: null });
});

await test("list_payees", async () => {
  const p = await call("list_payees", { budgetId: bid });
  if (p.length === 0) throw new Error("no payees");
});

let testPayeeId;
await test("get_payee", async () => {
  const payees = await call("list_payees", { budgetId: bid });
  testPayeeId = payees.find(p => !p.transfer_account_id && p.name !== "Starting Balance")?.id;
  const p = await call("get_payee", { budgetId: bid, payeeId: testPayeeId });
  if (!p.name) throw new Error("no payee name");
});

// --- Payee Locations ---
console.log("\n=== Payee Locations ===");

await test("list_payee_locations", async () => {
  const locs = await call("list_payee_locations", { budgetId: bid });
  if (!Array.isArray(locs)) throw new Error("not an array");
  console.log(`    ✓ ${locs.length} payee locations`);
});

await test("get_payee_locations_by_payee", async () => {
  const locs = await call("get_payee_locations_by_payee", { budgetId: bid, payeeId: testPayeeId });
  if (!Array.isArray(locs)) throw new Error("not an array");
});

await test("list_months", async () => {
  const m = await call("list_months", { budgetId: bid });
  if (m.length === 0) throw new Error("no months");
});

await test("get_month", async () => {
  const m = await call("get_month", { budgetId: bid, month: "2026-03-01" });
  if (!m.categories) throw new Error("no categories in month");
});

// --- Category & Category Group CRUD ---
console.log("\n=== Category & Category Group CRUD ===");

let testGroupId;
await test("create_category_group", async () => {
  const g = await call("create_category_group", { budgetId: bid, name: "MCP Test Group" });
  if (!g.id) throw new Error("no id returned");
  testGroupId = g.id;
  console.log(`    ✓ Created group: ${g.name} (${g.id})`);
});

await test("update_category_group", async () => {
  if (!testGroupId) throw new Error("no test group");
  const g = await call("update_category_group", { budgetId: bid, categoryGroupId: testGroupId, name: "MCP Test Group Renamed" });
  if (g.name !== "MCP Test Group Renamed") throw new Error("name not updated");
  console.log(`    ✓ Renamed group to: ${g.name}`);
});

let createdCatId;
await test("create_category", async () => {
  if (!testGroupId) throw new Error("no test group");
  const c = await call("create_category", { budgetId: bid, categoryGroupId: testGroupId, name: "MCP Test Category", note: "Test note" });
  if (!c.id) throw new Error("no id returned");
  createdCatId = c.id;
  console.log(`    ✓ Created category: ${c.name}`);
});

// Clean up: hide the test category by deleting its group's categories won't work via API,
// but we can at least verify the category was created correctly
await test("verify created category", async () => {
  if (!createdCatId) throw new Error("no test category");
  const c = await call("get_category", { budgetId: bid, categoryId: createdCatId });
  if (c.name !== "MCP Test Category") throw new Error("wrong name");
  if (c.note !== "Test note") throw new Error("wrong note");
  console.log(`    ✓ Verified category: ${c.name}, note: ${c.note}`);
});

// --- Money Movements ---
console.log("\n=== Money Movements ===");

await test("list_money_movements", async () => {
  const ms = await call("list_money_movements", { budgetId: bid });
  if (!Array.isArray(ms)) throw new Error("not an array");
  console.log(`    ✓ ${ms.length} money movements`);
});

await test("get_money_movements_by_month", async () => {
  const ms = await call("get_money_movements_by_month", { budgetId: bid, month: "2026-03-01" });
  if (!Array.isArray(ms)) throw new Error("not an array");
  console.log(`    ✓ ${ms.length} money movements in March 2026`);
  if (ms.length > 0 && typeof ms[0].amount !== "number") throw new Error("amount not converted to dollars");
});

await test("list_money_movement_groups", async () => {
  const gs = await call("list_money_movement_groups", { budgetId: bid });
  if (!Array.isArray(gs)) throw new Error("not an array");
  console.log(`    ✓ ${gs.length} money movement groups`);
});

await test("get_money_movement_groups_by_month", async () => {
  const gs = await call("get_money_movement_groups_by_month", { budgetId: bid, month: "2026-03-01" });
  if (!Array.isArray(gs)) throw new Error("not an array");
  console.log(`    ✓ ${gs.length} money movement groups in March 2026`);
});

// --- Transaction reads ---
console.log("\n=== Transaction Read Operations ===");

let unapproved;
await test("get_transactions (unapproved)", async () => {
  unapproved = await call("get_transactions", { budgetId: bid, type: "unapproved" });
  if (!Array.isArray(unapproved)) throw new Error("not an array");
  console.log(`    (${unapproved.length} unapproved transactions)`);
});

await test("get_transactions (by account)", async () => {
  const txns = await call("get_transactions", { budgetId: bid, accountId: testAccountId, sinceDate: "2026-03-01" });
  if (!Array.isArray(txns)) throw new Error("not an array");
});

await test("get_transactions (by category)", async () => {
  const txns = await call("get_transactions", { budgetId: bid, categoryId: testCatId, sinceDate: "2026-02-01" });
  if (!Array.isArray(txns)) throw new Error("not an array");
});

await test("get_transactions (by payee)", async () => {
  const txns = await call("get_transactions", { budgetId: bid, payeeId: testPayeeId, sinceDate: "2026-01-01" });
  if (!Array.isArray(txns)) throw new Error("not an array");
});

await test("get_transaction (single)", async () => {
  if (unapproved.length === 0) throw new Error("no transactions to test");
  const t = await call("get_transaction", { budgetId: bid, transactionId: unapproved[0].id });
  if (!t.id) throw new Error("no id");
  // Verify import_id field is present (even if null)
  if (!("import_id" in t)) throw new Error("import_id field missing from response");
});

// --- Transaction writes (idempotent — creates own test data, cleans up after) ---
console.log("\n=== Transaction Write Operations ===");

// Pick any active category for testing
const testCatForWrite = categories.flatMap(g => g.categories).find(c => !c.hidden);
if (!testCatForWrite) throw new Error("no visible category for write tests");

let createdTxnId;
await test("create_transaction", async () => {
  const t = await call("create_transaction", {
    budgetId: bid,
    accountId: testAccountId,
    date: new Date().toISOString().slice(0, 10),
    amount: -12.34,
    payeeName: "MCP Test Payee",
    categoryId: testCatForWrite.id,
    memo: "MCP integration test — safe to delete",
    approved: false,
  });
  if (!t.id) throw new Error("no id returned");
  if (t.amount !== -12.34) throw new Error(`wrong amount: ${t.amount}`);
  createdTxnId = t.id;
  console.log(`    ✓ Created ${t.payee_name} $${t.amount}`);
});

await test("update_transaction (recategorize + approve)", async () => {
  if (!createdTxnId) throw new Error("no test transaction to update");
  const t = await call("update_transaction", {
    budgetId: bid,
    transactionId: createdTxnId,
    memo: "MCP test — updated",
    approved: true,
  });
  if (t.approved !== true) throw new Error("not approved");
  if (t.memo !== "MCP test — updated") throw new Error("memo not changed");
  console.log(`    ✓ ${t.payee_name} → approved, memo updated`);
});

await test("update_transactions (batch update)", async () => {
  if (!createdTxnId) throw new Error("no test transaction for batch update");
  const result = await call("update_transactions", {
    budgetId: bid,
    transactions: [{ id: createdTxnId, memo: "MCP test — batch updated" }],
  });
  if (!result.updated || result.updated.length === 0) throw new Error("no transactions updated");
  console.log(`    ✓ Batch updated ${result.updated.length} transaction(s)`);
});

await test("delete_transaction", async () => {
  if (!createdTxnId) throw new Error("no test transaction to delete");
  const t = await call("delete_transaction", { budgetId: bid, transactionId: createdTxnId });
  if (!t.id) throw new Error("no id in delete response");
  console.log(`    ✓ Deleted ${t.payee_name} $${t.amount}`);
});

// Find a second category for split test
const secondCat = categories.flatMap(g => g.categories).find(c => !c.hidden && c.id !== testCatForWrite.id);
let splitTxnId;
await test("create_transaction (split)", async () => {
  if (!secondCat) throw new Error("need 2 categories for split test");
  const t = await call("create_transaction", {
    budgetId: bid,
    accountId: testAccountId,
    date: new Date().toISOString().slice(0, 10),
    amount: -25.00,
    payeeName: "MCP Split Test",
    memo: "MCP split test — safe to delete",
    approved: false,
    subtransactions: [
      { amount: -15.00, categoryId: testCatForWrite.id, memo: "part 1" },
      { amount: -10.00, categoryId: secondCat.id, memo: "part 2" },
    ],
  });
  if (!t.id) throw new Error("no id returned");
  if (!t.subtransactions || t.subtransactions.length !== 2) throw new Error(`expected 2 subtransactions, got ${t.subtransactions?.length}`);
  splitTxnId = t.id;
  console.log(`    ✓ Created split: ${t.subtransactions.map(s => `$${s.amount}`).join(" + ")}`);
  // Clean up
  await call("delete_transaction", { budgetId: bid, transactionId: splitTxnId });
});

await test("create_transactions (bulk)", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const result = await call("create_transactions", {
    budgetId: bid,
    transactions: [
      { accountId: testAccountId, date: today, amount: -5.00, payeeName: "MCP Bulk Test 1", categoryId: testCatForWrite.id, memo: "bulk test — safe to delete", approved: false },
      { accountId: testAccountId, date: today, amount: -3.50, payeeName: "MCP Bulk Test 2", categoryId: testCatForWrite.id, memo: "bulk test — safe to delete", approved: false },
    ],
  });
  if (!result.created || result.created.length !== 2) throw new Error(`expected 2 created, got ${result.created?.length}`);
  console.log(`    ✓ Bulk created ${result.created.length} transactions`);
  // Clean up
  for (const t of result.created) {
    await call("delete_transaction", { budgetId: bid, transactionId: t.id });
  }
});

await test("import_transactions", async () => {
  const result = await call("import_transactions", { budgetId: bid });
  if (result === undefined) throw new Error("no result");
});

// --- Convenience tools ---
console.log("\n=== Convenience Tools ===");

await test("search_categories", async () => {
  const results = await call("search_categories", { budgetId: bid, query: "eat" });
  if (!Array.isArray(results)) throw new Error("expected array");
  if (results.length === 0) throw new Error("no results for 'eat'");
  console.log(`    ✓ Found ${results.length} categories matching 'eat'`);
});

await test("search_payees", async () => {
  const results = await call("search_payees", { budgetId: bid, query: "transfer" });
  if (!Array.isArray(results) && !results.message) throw new Error("unexpected response shape");
});

await test("review_unapproved", async () => {
  const result = await call("review_unapproved", { budgetId: bid });
  if (typeof result.total !== "number") throw new Error("missing total");
  if (!result.ready_to_approve) throw new Error("missing ready_to_approve");
  if (!result.needs_category_first) throw new Error("missing needs_category_first");
  console.log(`    ✓ ${result.total} unapproved (${result.ready_to_approve.count} ready, ${result.needs_category_first.count} need category)`);
});

await test("get_transactions (by month)", async () => {
  const txns = await call("get_transactions", { budgetId: bid, month: "2026-03-01" });
  if (!Array.isArray(txns)) throw new Error("not an array");
  console.log(`    ✓ ${txns.length} transactions in March 2026`);
});

// --- Scheduled transactions ---
console.log("\n=== Scheduled Transaction Operations ===");

await test("list_scheduled_transactions", async () => {
  const s = await call("list_scheduled_transactions", { budgetId: bid });
  if (!Array.isArray(s)) throw new Error("not an array");
});

let testScheduledTxn;
await test("get_scheduled_transaction", async () => {
  const list = await call("list_scheduled_transactions", { budgetId: bid });
  if (list.length === 0) throw new Error("no scheduled transactions");
  testScheduledTxn = list[0];
  const s = await call("get_scheduled_transaction", { budgetId: bid, scheduledTransactionId: testScheduledTxn.id });
  if (!s.id) throw new Error("no id");
  // Verify subtransactions field is present
  if (!("subtransactions" in s)) throw new Error("subtransactions field missing");
});

await test("update_scheduled_transaction (update memo, verify round-trip)", async () => {
  if (!testScheduledTxn) throw new Error("no scheduled transaction to update");
  const marker = `MCP test ${Date.now()}`;
  const original = await call("get_scheduled_transaction", { budgetId: bid, scheduledTransactionId: testScheduledTxn.id });
  const updated = await call("update_scheduled_transaction", {
    budgetId: bid,
    scheduledTransactionId: testScheduledTxn.id,
    memo: marker,
  });
  if (updated.memo !== marker) throw new Error("memo not updated");
  // Verify other fields preserved (fetch-then-merge worked)
  if (updated.amount !== original.amount) throw new Error(`amount changed: ${original.amount} -> ${updated.amount}`);
  if (updated.frequency !== original.frequency) throw new Error("frequency changed");
  // Clean up — restore original memo
  await call("update_scheduled_transaction", {
    budgetId: bid,
    scheduledTransactionId: testScheduledTxn.id,
    memo: original.memo,
  });
});

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

await client.close();
process.exit(failed > 0 ? 1 : 0);
