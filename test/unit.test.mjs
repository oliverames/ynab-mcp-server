// Offline unit tests for the pure helpers exported by index.js.
// No YNAB credentials or network access required.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
process.env.YNAB_API_TOKEN = "unit-test-token";
delete process.env.YNAB_BUDGET_ID;

const {
  dollars,
  milliunits,
  round2,
  dollarsMap,
  resolveBudgetId,
  normalizeTransactionId,
  mapTransactionInput,
  mapTransactionUpdate,
  transactionUpdateMismatches,
  updateFieldMatches,
  parseSimpleTomlSections,
  stripTomlComment,
  buildYnabUrl,
  buildTransactionListPath,
  sanitizeErrorMessage,
  withWriteGateDescription,
  parseToolExecuteInput,
  verifyBulkTransactionUpdates,
  beforeFieldsForUpdate,
  summarizeIncomeExpenseByMonth,
  detectRecurringFromTransactions,
  csvEscape,
  buildTransactionsCsv,
  currentBudgetMonth,
} = await import("../index.js");

test("dollars converts milliunits and passes null through", () => {
  assert.equal(dollars(-12340), -12.34);
  assert.equal(dollars(35710), 35.71);
  assert.equal(dollars(0), 0);
  assert.equal(dollars(null), null);
  assert.equal(dollars(undefined), null);
});

test("milliunits rounds dollars to integer milliunits", () => {
  assert.equal(milliunits(-12.34), -12340);
  assert.equal(milliunits(0.005), 5);
  assert.equal(milliunits(1.0000001), 1000);
});

test("round2 kills IEEE-754 sum artifacts and passes null through", () => {
  assert.equal(round2(25.68 + 17.6 + 10.45 - 107.46), -53.73);
  assert.equal(round2(-53.730000000000004), -53.73);
  assert.equal(round2(null), null);
  assert.equal(round2(undefined), undefined);
});

test("dollarsMap converts every value and passes falsy input through", () => {
  assert.deepEqual(dollarsMap({ a: 1000, b: -2500 }), { a: 1, b: -2.5 });
  assert.equal(dollarsMap(null), null);
  assert.equal(dollarsMap(undefined), undefined);
});

test("resolveBudgetId falls back to last-used", () => {
  assert.equal(resolveBudgetId("abc"), "abc");
  assert.equal(resolveBudgetId(undefined), "last-used");
});

test("normalizeTransactionId strips composite scheduled-transaction date suffixes", () => {
  assert.equal(normalizeTransactionId("uuid-123_2026-04-30"), "uuid-123");
  assert.equal(normalizeTransactionId("uuid-123"), "uuid-123");
  assert.equal(normalizeTransactionId("uuid_2026-04-30_2026-05-31"), "uuid_2026-04-30");
});

test("mapTransactionInput converts amounts and subtransactions", () => {
  const mapped = mapTransactionInput({
    accountId: "acct",
    date: "2026-01-02",
    amount: -25,
    payeeName: "Test",
    subtransactions: [
      { amount: -15, categoryId: "c1" },
      { amount: -10, categoryId: "c2", memo: "part 2" },
    ],
  });
  assert.equal(mapped.amount, -25000);
  assert.equal(mapped.account_id, "acct");
  assert.deepEqual(
    mapped.subtransactions.map((s) => s.amount),
    [-15000, -10000],
  );
});

test("mapTransactionUpdate is sparse: only provided fields appear", () => {
  assert.deepEqual(mapTransactionUpdate({}), {});
  assert.deepEqual(mapTransactionUpdate({ approved: true }), { approved: true });
  assert.deepEqual(mapTransactionUpdate({ categoryId: null, memo: null }), {
    category_id: null,
    memo: null,
  });
  assert.deepEqual(mapTransactionUpdate({ amount: -1.5 }), { amount: -1500 });
});

test("mapTransactionUpdate converts subtransactions when provided", () => {
  const mapped = mapTransactionUpdate({
    subtransactions: [
      { amount: -15, categoryId: "c1" },
      { amount: -10, categoryId: "c2", payeeName: "Split payee", memo: "part 2" },
    ],
  });
  assert.deepEqual(mapped, {
    subtransactions: [
      { amount: -15000, category_id: "c1", payee_id: undefined, payee_name: undefined, memo: undefined },
      { amount: -10000, category_id: "c2", payee_id: undefined, payee_name: "Split payee", memo: "part 2" },
    ],
  });
  assert.equal(mapTransactionUpdate({ approved: true }).subtransactions, undefined);
});

test("parseToolExecuteInput accepts importId-based bulk updates and enforces limits", () => {
  const parsed = parseToolExecuteInput("update_transactions", {
    transactions: [{ importId: "YNAB:-25000:2026-01-02:1", approved: true }],
  });
  assert.equal(parsed.transactions[0].importId, "YNAB:-25000:2026-01-02:1");
  assert.throws(
    () => parseToolExecuteInput("update_transactions", {
      transactions: [{ id: "t1", payeeName: "x".repeat(201) }],
    }),
    /Invalid input for update_transactions/,
  );
});

test("parseToolExecuteInput accepts get_budget delta and list_budgets includeAccounts params", () => {
  assert.deepEqual(
    parseToolExecuteInput("get_budget", { lastKnowledgeOfServer: 0 }),
    { lastKnowledgeOfServer: 0 },
  );
  assert.deepEqual(
    parseToolExecuteInput("list_budgets", { includeAccounts: true }),
    { includeAccounts: true },
  );
  assert.throws(
    () => parseToolExecuteInput("get_budget", { lastKnowledgeOfServer: -1 }),
    /Invalid input for get_budget/,
  );
});

test("updateFieldMatches compares numbers with tolerance and others strictly", () => {
  assert.equal(updateFieldMatches(-12.34, -12.34000000001), true);
  assert.equal(updateFieldMatches(-12.34, -12.35), false);
  assert.equal(updateFieldMatches("a", "a"), true);
  assert.equal(updateFieldMatches(null, null), true);
  assert.equal(updateFieldMatches(true, false), false);
});

test("transactionUpdateMismatches only checks requested fields", () => {
  const requested = { id: "t1", categoryId: "cat-1", approved: true };
  const persisted = { category_id: "cat-1", approved: true, memo: "unrelated" };
  assert.deepEqual(transactionUpdateMismatches(requested, persisted), []);

  const drifted = { category_id: null, approved: true };
  const mismatches = transactionUpdateMismatches(requested, drifted);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].field, "categoryId");
  assert.equal(mismatches[0].expected, "cat-1");
  assert.equal(mismatches[0].actual, null);
});

test("parseSimpleTomlSections parses sections, strings, and comments", () => {
  const sections = parseSimpleTomlSections([
    "# top comment",
    "[shell_environment_policy.set]",
    'YNAB_API_TOKEN = "token-value" # trailing comment',
    "YNAB_BUDGET_ID = 'budget-id'",
    "",
    "[mcp_servers.ynab.env]",
    'YNAB_ALLOW_WRITES = "1"',
    'HASHY = "contains # not a comment"',
  ].join("\n"));
  assert.equal(sections["shell_environment_policy.set"].YNAB_API_TOKEN, "token-value");
  assert.equal(sections["shell_environment_policy.set"].YNAB_BUDGET_ID, "budget-id");
  assert.equal(sections["mcp_servers.ynab.env"].YNAB_ALLOW_WRITES, "1");
  assert.equal(sections["mcp_servers.ynab.env"].HASHY, "contains # not a comment");
});

test("stripTomlComment respects quotes and escapes", () => {
  assert.equal(stripTomlComment('"a # b" # comment'), '"a # b" ');
  assert.equal(stripTomlComment("plain # comment"), "plain ");
  assert.equal(stripTomlComment('"no comment"'), '"no comment"');
});

test("buildYnabUrl only accepts safe absolute API paths", () => {
  assert.equal(
    buildYnabUrl("/plans/abc/transactions").toString(),
    "https://api.ynab.com/v1/plans/abc/transactions",
  );
  assert.throws(() => buildYnabUrl("plans/abc"), /unsafe/);
  assert.throws(() => buildYnabUrl("//evil.example.com/x"), /unsafe/);
  assert.throws(() => buildYnabUrl("https://evil.example.com/x"), /unsafe/);
  assert.throws(() => buildYnabUrl("/plans/abc\r\nHeader: injected"), /unsafe/);
});

test("buildTransactionListPath picks the right resource scope", () => {
  assert.equal(
    buildTransactionListPath({ budgetId: "b" }),
    "/plans/b/transactions",
  );
  assert.equal(
    buildTransactionListPath({ budgetId: "b", accountId: "a" }),
    "/plans/b/accounts/a/transactions",
  );
  assert.equal(
    buildTransactionListPath({ budgetId: "b", categoryId: "c" }),
    "/plans/b/categories/c/transactions",
  );
  assert.equal(
    buildTransactionListPath({ budgetId: "b", payeeId: "p" }),
    "/plans/b/payees/p/transactions",
  );
  assert.equal(
    buildTransactionListPath({ budgetId: "b", month: "2026-01-01" }),
    "/plans/b/months/2026-01-01/transactions",
  );
});

test("sanitizeErrorMessage redacts tokens and auth headers", () => {
  assert.equal(
    sanitizeErrorMessage("failed with unit-test-token in body"),
    "failed with [REDACTED_TOKEN] in body",
  );
  assert.equal(
    sanitizeErrorMessage("Bearer abc.DEF-123 rejected"),
    "Bearer [REDACTED_TOKEN] rejected",
  );
  assert.match(
    sanitizeErrorMessage("Authorization: Bearer whatever"),
    /Authorization: \[REDACTED_TOKEN\]/,
  );
});

test("withWriteGateDescription appends the gate note exactly once", () => {
  const gated = withWriteGateDescription("Create a transaction.");
  assert.match(gated, /YNAB_ALLOW_WRITES=1/);
  assert.equal(withWriteGateDescription(gated), gated);
});

test("verifyBulkTransactionUpdates verifies a batch with a single list refetch", async (t) => {
  const requests = [];
  const listTransactions = [
    { id: "t1", date: "2026-06-01", amount: -10000, approved: true, deleted: false },
    { id: "t2", date: "2026-06-02", amount: -20000, approved: true, deleted: false },
  ];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ data: { transactions: listTransactions } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  const responseTxns = listTransactions.map((tx) => ({ ...tx }));
  const requested = [
    { id: "t1", approved: true },
    { id: "t2", approved: true },
  ];
  const { verification, verified } = await verifyBulkTransactionUpdates("plan-1", requested, responseTxns);

  assert.equal(verification.checked, 2);
  assert.deepEqual(verification.retried, []);
  assert.deepEqual(verification.failed, []);
  assert.equal(verified.length, 2);
  assert.equal(verified[0].approved, true);
  // The whole batch must be verified with exactly one list request —
  // one GET per transaction starves the shared YNAB rate budget.
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/plans\/plan-1\/transactions\?since_date=2026-06-01/);
});

test("parseToolExecuteInput validates against the target tool schema", () => {
  // Valid input passes through with defaults/stripping applied.
  assert.deepEqual(
    parseToolExecuteInput("review_unapproved", { summary: true }),
    { summary: true },
  );
  // Missing required field is rejected with a descriptive error.
  assert.throws(
    () => parseToolExecuteInput("get_account", { budgetId: "b" }),
    /Invalid input for get_account: accountId/,
  );
  // Wrong type is rejected.
  assert.throws(
    () => parseToolExecuteInput("review_unapproved", { summary: "yes" }),
    /Invalid input for review_unapproved: summary/,
  );
  // Tools without an input schema accept any object.
  assert.deepEqual(parseToolExecuteInput("get_user", undefined), {});
});

// --- v4.0 helpers ---

test("beforeFieldsForUpdate captures only the requested fields' before-values", () => {
  const before = { category_id: "old-cat", approved: false, memo: "old memo", payee_id: "p1" };
  const requested = { id: "t1", categoryId: "new-cat", approved: true };
  assert.deepEqual(beforeFieldsForUpdate(requested, before), {
    categoryId: "old-cat",
    approved: false,
  });
  assert.equal(beforeFieldsForUpdate(requested, null), null);
});

test("summarizeIncomeExpenseByMonth separates income, spending, and transfers", () => {
  const txns = [
    { date: "2026-06-01", amount: 5000, category_name: "Inflow: Ready to Assign", transfer_account_id: null, deleted: false },
    { date: "2026-06-05", amount: -1000, category_name: "Groceries", transfer_account_id: null, deleted: false },
    { date: "2026-06-07", amount: -500, category_name: null, transfer_account_id: "acct-2", deleted: false }, // transfer: excluded
    { date: "2026-06-09", amount: -200, category_name: "Dining", transfer_account_id: null, deleted: true }, // deleted: excluded
    { date: "2026-07-01", amount: 4000, category_name: "Inflow: Ready to Assign", transfer_account_id: null, deleted: false },
    { date: "2026-07-02", amount: -1000, category_name: "Rent", transfer_account_id: null, deleted: false },
  ];
  const months = summarizeIncomeExpenseByMonth(txns);
  assert.deepEqual(months, [
    { month: "2026-06", income: 5000, spending: 1000, net: 4000, savings_rate_pct: 80 },
    { month: "2026-07", income: 4000, spending: 1000, net: 3000, savings_rate_pct: 75 },
  ]);
});

test("detectRecurringFromTransactions finds a monthly cadence and annualizes it", () => {
  const sub = (date) => ({ date, amount: -15.99, payee_name: "Streamflix", payee_id: "p-s", category_name: "Subscriptions", transfer_account_id: null, deleted: false });
  const noise = (date, amount) => ({ date, amount, payee_name: "Grocer", payee_id: "p-g", category_name: "Groceries", transfer_account_id: null, deleted: false });
  const txns = [sub("2026-01-14"), sub("2026-02-14"), sub("2026-03-15"), sub("2026-04-14"),
    noise("2026-01-02", -52.11), noise("2026-02-19", -8.4)];
  const found = detectRecurringFromTransactions(txns);
  assert.equal(found.length, 1);
  assert.equal(found[0].payee_name, "Streamflix");
  assert.equal(found[0].cadence, "monthly");
  assert.equal(found[0].occurrences, 4);
  assert.equal(found[0].estimated_annual_cost, round2(15.99 * (365 / 30)));
});

test("detectRecurringFromTransactions ignores inflows, transfers, and sparse groups", () => {
  const txns = [
    { date: "2026-01-01", amount: 100, payee_name: "Employer", payee_id: "p1", transfer_account_id: null, deleted: false },
    { date: "2026-02-01", amount: 100, payee_name: "Employer", payee_id: "p1", transfer_account_id: null, deleted: false },
    { date: "2026-03-01", amount: 100, payee_name: "Employer", payee_id: "p1", transfer_account_id: null, deleted: false },
    { date: "2026-01-05", amount: -50, payee_name: "Savings", payee_id: "p2", transfer_account_id: "a2", deleted: false },
    { date: "2026-01-09", amount: -9.99, payee_name: "OneOff", payee_id: "p3", transfer_account_id: null, deleted: false },
  ];
  assert.deepEqual(detectRecurringFromTransactions(txns), []);
});

test("csvEscape quotes commas, quotes, and newlines", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape('has "quotes"'), '"has ""quotes"""');
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape("line\nbreak"), '"line\nbreak"');
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(undefined), "");
});

test("buildTransactionsCsv emits header plus one row per transaction", () => {
  const csv = buildTransactionsCsv([
    { date: "2026-06-01", amount: -12.34, payee_name: "Cafe, The", category_name: "Dining", account_name: "Checking", memo: null, cleared: "cleared", approved: true, transfer_account_id: null, id: "t1" },
  ]);
  const lines = csv.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "date,amount,payee,category,account,memo,cleared,approved,transfer,id");
  assert.equal(lines[1], '2026-06-01,-12.34,"Cafe, The",Dining,Checking,,cleared,true,,t1');
});

test("currentBudgetMonth is the first of the current month", () => {
  assert.match(currentBudgetMonth(), /^\d{4}-\d{2}-01$/);
});
