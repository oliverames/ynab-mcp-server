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
  if (text.startsWith("Error")) throw new Error(text);
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
  const budgets = await call("list_budgets");
  if (budgets.length === 0) throw new Error("no budgets");
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
});

await test("get_month_category", async () => {
  const c = await call("get_month_category", { budgetId: bid, month: "2026-03-01", categoryId: testCatId });
  if (typeof c.budgeted !== "number") throw new Error("budgeted not a number");
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

await test("list_months", async () => {
  const m = await call("list_months", { budgetId: bid });
  if (m.length === 0) throw new Error("no months");
});

await test("get_month", async () => {
  const m = await call("get_month", { budgetId: bid, month: "2026-03-01" });
  if (!m.categories) throw new Error("no categories in month");
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
});

// --- Transaction writes ---
console.log("\n=== Transaction Write Operations ===");

// Find the Irving Berlin $7.41 transaction — needs recategorize to Eating Out + approve
const irvingBerlin = unapproved.find(t => t.payee_name?.includes("Irving Berlin") && t.amount === -7.41);

await test("update_transaction (recategorize + approve — Irving Berlin → Eating Out)", async () => {
  if (!irvingBerlin) throw new Error("Irving Berlin txn not found");
  const eatingOutId = catByName["🥡 Eating Out"];
  if (!eatingOutId) throw new Error("Eating Out category not found");
  const t = await call("update_transaction", {
    budgetId: bid,
    transactionId: irvingBerlin.id,
    categoryId: eatingOutId,
    approved: true,
  });
  if (t.category_id !== eatingOutId) throw new Error("category not changed: " + t.category_name);
  if (t.approved !== true) throw new Error("not approved");
  console.log(`    ✓ ${t.payee_name} → ${t.category_name}, approved`);
});

// Find Shaw's grocery $369.08 — just approve
const shaws = unapproved.find(t => t.payee_name?.includes("Shaw") && t.amount === -369.08);

await test("update_transaction (approve — Shaw's Groceries)", async () => {
  if (!shaws) throw new Error("Shaw's txn not found");
  const t = await call("update_transaction", {
    budgetId: bid,
    transactionId: shaws.id,
    approved: true,
  });
  if (t.approved !== true) throw new Error("not approved");
  console.log(`    ✓ ${t.payee_name} $${t.amount} → approved`);
});

// Find Etsy $51.96 — recategorize to Kaitlin + approve
const etsy = unapproved.find(t => t.payee_name?.includes("Etsy") && t.amount === -51.96);

await test("update_transaction (recategorize + approve — Etsy → Kaitlin)", async () => {
  if (!etsy) throw new Error("Etsy txn not found");
  const kaitlinId = catByName["👩 Kaitlin"];
  if (!kaitlinId) throw new Error("Kaitlin category not found");
  const t = await call("update_transaction", {
    budgetId: bid,
    transactionId: etsy.id,
    categoryId: kaitlinId,
    approved: true,
  });
  if (t.category_id !== kaitlinId) throw new Error("category not changed");
  if (t.approved !== true) throw new Error("not approved");
  console.log(`    ✓ ${t.payee_name} → ${t.category_name}, approved`);
});

// Find Aubuchon Hardware $41.70 — recategorize to Henry + approve
const aubuchon = unapproved.find(t => t.payee_name?.includes("Aubuchon") && t.amount === -41.70);

await test("update_transaction (recategorize + approve — Aubuchon → Henry)", async () => {
  if (!aubuchon) throw new Error("Aubuchon txn not found");
  const henryId = catByName["🧒 Henry"];
  if (!henryId) throw new Error("Henry category not found");
  const t = await call("update_transaction", {
    budgetId: bid,
    transactionId: aubuchon.id,
    categoryId: henryId,
    approved: true,
  });
  if (t.category_id !== henryId) throw new Error("category not changed");
  if (t.approved !== true) throw new Error("not approved");
  console.log(`    ✓ ${t.payee_name} → ${t.category_name}, approved`);
});

// Test batch approve — several approve-as-is transactions
const approveOnly = [];
const approvePayees = ["Adobe", "ElevenLabs", "Mimestream", "Dunkin'", "AT&T"];
for (const name of approvePayees) {
  const txn = unapproved.find(t => t.payee_name?.includes(name) && !t.approved);
  if (txn) approveOnly.push(txn);
}

await test(`update_transactions (batch approve ${approveOnly.length} transactions)`, async () => {
  if (approveOnly.length === 0) throw new Error("no matching transactions");
  const result = await call("update_transactions", {
    budgetId: bid,
    transactions: approveOnly.map(t => ({ id: t.id, approved: true })),
  });
  if (!result.updated || result.updated.length < approveOnly.length) {
    throw new Error(`expected ${approveOnly.length} updated, got ${result.updated?.length}`);
  }
  for (const t of result.updated) {
    if (t.approved !== true) throw new Error(`${t.payee_name} not approved`);
    console.log(`    ✓ ${t.payee_name} $${t.amount} → approved`);
  }
});

await test("import_transactions", async () => {
  const result = await call("import_transactions", { budgetId: bid });
  if (result === undefined) throw new Error("no result");
});

// --- Scheduled transactions ---
console.log("\n=== Scheduled Transaction Operations ===");

await test("list_scheduled_transactions", async () => {
  const s = await call("list_scheduled_transactions", { budgetId: bid });
  if (!Array.isArray(s)) throw new Error("not an array");
});

await test("get_scheduled_transaction", async () => {
  const list = await call("list_scheduled_transactions", { budgetId: bid });
  if (list.length === 0) throw new Error("no scheduled transactions");
  const s = await call("get_scheduled_transaction", { budgetId: bid, scheduledTransactionId: list[0].id });
  if (!s.id) throw new Error("no id");
});

// --- Summary ---
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

await client.close();
process.exit(failed > 0 ? 1 : 0);
