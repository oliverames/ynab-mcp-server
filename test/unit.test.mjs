// Offline unit tests for the pure helpers exported by index.js.
// No YNAB credentials or network access required.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
process.env.YNAB_API_TOKEN = "unit-test-token";
delete process.env.YNAB_BUDGET_ID;

const {
  envNumber,
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
  summarizeApprovalChanges,
  decodeHtmlEntities,
  decodeTextFieldsDeep,
  normalizeSearchText,
  matchCategoriesByQuery,
  slimUnapprovedTransaction,
  buildUnapprovedPayeeGroups,
  summarizeIncomeExpenseByMonth,
  detectRecurringFromTransactions,
  csvEscape,
  csvSafeText,
  buildTransactionsCsv,
  currentBudgetMonth,
  invokeRegisteredTool,
} = await import("../index.js");
const { createYnabServer, createFsJournal } = await import("../index.js");

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

test("parseSimpleTomlSections flattens dotted keys into pseudo-sections", () => {
  const sections = parseSimpleTomlSections([
    "[mcp_servers.ynab]",
    'command = "npx"',
    "env.YNAB_API_TOKEN = \"dotted-token\"",
    "env.YNAB_BUDGET_ID = 'dotted-budget'",
  ].join("\n"));
  assert.equal(sections["mcp_servers.ynab"].command, "npx");
  assert.equal(sections["mcp_servers.ynab.env"].YNAB_API_TOKEN, "dotted-token");
  assert.equal(sections["mcp_servers.ynab.env"].YNAB_BUDGET_ID, "dotted-budget");
});

test("parseSimpleTomlSections flattens inline-table env blocks", () => {
  const sections = parseSimpleTomlSections([
    "[mcp_servers.ynab]",
    'command = "npx"',
    'env = { YNAB_API_TOKEN = "inline-token", YNAB_ALLOW_WRITES = \'1\' }',
  ].join("\n"));
  assert.equal(sections["mcp_servers.ynab.env"].YNAB_API_TOKEN, "inline-token");
  assert.equal(sections["mcp_servers.ynab.env"].YNAB_ALLOW_WRITES, "1");
});

test("inline tables keep quoted commas intact and reject nested values", () => {
  const sections = parseSimpleTomlSections([
    "[mcp_servers.ynab.env]",
    'YNAB_API_TOKEN = { VALUE = "a,b#c" }',
  ].join("\n"));
  assert.equal(sections["mcp_servers.ynab.env.YNAB_API_TOKEN"].VALUE, "a,b#c");

  // Nested or malformed tables stay opaque strings instead of crashing.
  const opaque = parseSimpleTomlSections([
    "[mcp_servers.x]",
    "env = { outer = { inner = 1 } }",
  ].join("\n"));
  assert.equal(typeof opaque["mcp_servers.x"].env, "string");
});

test("createFsJournal persists entries atomically and reads them back", async (t) => {
  const { mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { rmSync, existsSync } = await import("node:fs");
  const dir = mkdtempSync(join("/tmp", "ynab-journal-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const journalPath = join(dir, "undo.json");
  const journal = createFsJournal(journalPath);
  await journal.persist([{ id: "e1" }, { id: "e2" }]);
  assert.deepEqual(await journal.read(), [{ id: "e1" }, { id: "e2" }]);
  // The staging file must not survive a completed persist.
  assert.equal(existsSync(`${journalPath}.tmp`), false);
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

test("verifyBulkTransactionUpdates bounds the refetch when no row carries a date", async (t) => {
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ data: { transactions: [
      { id: "t1", date: "2026-06-01", amount: -10000, approved: true, deleted: false },
    ] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { globalThis.fetch = realFetch; });

  // An approval-style batch ({ id, approved } only) whose PATCH response
  // omitted transactions must still produce one windowed list refetch rather
  // than falling straight into one GET per transaction.
  const { verification } = await verifyBulkTransactionUpdates("plan-1", [{ id: "t1", approved: true }]);

  assert.equal(verification.failed.length, 0);
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/plans\/plan-1\/transactions\?since_date=\d{4}-\d{2}-\d{2}/);
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

test("export_transactions accepts the same type filter as get_transactions", () => {
  assert.deepEqual(
    parseToolExecuteInput("export_transactions", { type: "unapproved" }),
    { type: "unapproved" },
  );
  assert.throws(
    () => parseToolExecuteInput("export_transactions", { type: "everything" }),
    /Invalid input for export_transactions: type/,
  );
});

test("invokeRegisteredTool wraps passthrough results like a direct call", async () => {
  const instance = createYnabServer({ hasCredentials: false, writesEnabled: false, journal: null });
  const result = await instance.internals.invokeRegisteredTool("ynab_auth_status", {});
  assert.equal(result.isError ?? false, false);
  assert.deepEqual(result.structuredContent, { result: JSON.parse(result.content[0].text) });
});

test("invokeRegisteredTool cannot reach write tools when writes are disabled", async () => {
  const instance = createYnabServer({ hasCredentials: true, writesEnabled: false, journal: null });
  assert.equal(await instance.internals.invokeRegisteredTool("delete_transaction", {}), null);
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

test("buildTransactionsCsv neutralizes formula-leading text cells but keeps numeric columns exact", () => {
  const csv = buildTransactionsCsv([
    {
      date: "2026-06-01", amount: -12.34,
      payee_name: "=cmd|'/c'!A0", category_name: "+SUM(A1)", account_name: "@x", memo: "-1+1",
      cleared: "cleared", approved: true, transfer_account_id: null, id: "t1",
    },
  ]);
  const cells = csv.split("\n")[1].split(",");
  // Free-text columns are guarded with a leading apostrophe.
  assert.equal(cells[2], "'=cmd|'/c'!A0");
  assert.equal(cells[3], "'+SUM(A1)");
  assert.equal(cells[4], "'@x");
  assert.equal(cells[5], "'-1+1");
  // Date, amount, and id must stay byte-exact for programmatic consumers.
  assert.equal(cells[0], "2026-06-01");
  assert.equal(cells[1], "-12.34");
  assert.equal(cells[9], "t1");
});

test("csvSafeText only guards values that begin with a formula character", () => {
  assert.equal(csvSafeText("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvSafeText("+1"), "'+1");
  assert.equal(csvSafeText("-refi"), "'-refi");
  assert.equal(csvSafeText("@sum"), "'@sum");
  assert.equal(csvSafeText("\tcmd"), "'\tcmd");
  assert.equal(csvSafeText("\rline"), "'\rline");
  assert.equal(csvSafeText("-40.50 adjustment"), "'-40.50 adjustment");
  assert.equal(csvSafeText("plain text"), "plain text");
  assert.equal(csvSafeText(""), "");
  assert.equal(csvSafeText(null), null);
  assert.equal(csvSafeText(undefined), undefined);
});

test("currentBudgetMonth is the first of the current month", () => {
  assert.match(currentBudgetMonth(), /^\d{4}-\d{2}-01$/);
});

// --- v5.2 connector-finding fixes ---

test("buildUnapprovedPayeeGroups reports every category a group spans", () => {
  const txns = [
    { id: "t1", payee_name: "Venmo", amount: -20, category_name: "🏖️ Cuttyhunk", flags: [] },
    { id: "t2", payee_name: "Venmo", amount: -30, category_name: "🚲 eBike", flags: [] },
    { id: "t3", payee_name: "Venmo", amount: -40, category_name: "🚲 eBike", flags: [] },
    { id: "t4", payee_name: "Venmo", amount: -10, category_name: "🚲 eBike", flags: [] },
  ];
  const [group] = buildUnapprovedPayeeGroups(txns, { summary: true });
  // The first row's category must not stand in for the whole group.
  assert.equal(group.category_name, null);
  assert.equal(group.mixed_categories, true);
  assert.deepEqual(group.category_names, ["🏖️ Cuttyhunk", "🚲 eBike"]);
  assert.equal(group.count, 4);
  assert.equal(group.total, -100);
});

test("buildUnapprovedPayeeGroups keeps a single-category header simple", () => {
  const txns = [
    { id: "t1", payee_name: "Cafe", amount: -5, category_name: "Dining", flags: ["new_payee"] },
    { id: "t2", payee_name: "Cafe", amount: -7, category_name: "Dining", flags: [] },
  ];
  const [group] = buildUnapprovedPayeeGroups(txns, { summary: true });
  assert.equal(group.category_name, "Dining");
  assert.equal(group.mixed_categories, false);
  assert.deepEqual(group.category_names, ["Dining"]);
  assert.equal(group.mixed_amount_signs, false);
  assert.equal("inflow_total" in group, false);
  assert.deepEqual(group.flags, ["new_payee"]);
});

test("buildUnapprovedPayeeGroups splits inflow and outflow when a net hides reversals", () => {
  const txns = [
    { id: "t1", payee_name: "Adobe", amount: -22.83, category_name: "Software", flags: [] },
    { id: "t2", payee_name: "Adobe", amount: -10, category_name: "Software", flags: [] },
    { id: "t3", payee_name: "Adobe", amount: 10, category_name: "Software", flags: [] },
    { id: "t4", payee_name: "Adobe", amount: 9.99, category_name: "Software", flags: [] },
    { id: "t5", payee_name: "Adobe", amount: 0.01, category_name: "Software", flags: [] },
  ];
  const [group] = buildUnapprovedPayeeGroups(txns, { summary: true });
  assert.equal(group.total, -12.83);
  assert.equal(group.mixed_amount_signs, true);
  assert.equal(group.inflow_total, 20);
  assert.equal(group.outflow_total, -32.83);
});

test("buildUnapprovedPayeeGroups treats a categoryless row as mixed", () => {
  const txns = [
    { id: "t1", payee_name: "Chase", amount: -100, category_name: null, flags: [] },
    { id: "t2", payee_name: "Chase", amount: -20, category_name: "Fees", flags: [] },
  ];
  const [group] = buildUnapprovedPayeeGroups(txns, { summary: true });
  assert.equal(group.mixed_categories, true);
  assert.equal(group.category_name, null);
  assert.deepEqual(group.category_names, ["Fees"]);
});

test("compact rows keep matched_transaction_id only for match_broken", () => {
  const broken = slimUnapprovedTransaction({
    id: "t1", date: "2026-07-01", payee_name: "Venmo", amount: -20,
    category_name: "Dining", account_name: "Checking", memo: "bulky",
    matched_transaction_id: "m1", import_id: null, flags: ["match_broken"],
  });
  assert.equal(broken.matched_transaction_id, "m1");
  assert.equal("memo" in broken, false);

  const clean = slimUnapprovedTransaction({
    id: "t2", date: "2026-07-01", payee_name: "Cafe", amount: -5,
    category_name: "Dining", account_name: "Checking",
    matched_transaction_id: "m2", flags: [],
  });
  assert.equal("matched_transaction_id" in clean, false);
});

test("summarizeApprovalChanges separates newly approved from already approved", () => {
  const requested = [
    { id: "t1", approved: true },
    { id: "t2", categoryId: "c1" },
    { id: "t3", categoryId: "c2" },
    { id: "t4", approved: true },
  ];
  const before = new Map([
    ["t1", { approved: false }],
    ["t2", { approved: true }],
    ["t3", { approved: true }],
    // t4 has no before-state (importId row whose refetch failed)
  ]);
  const verified = [
    { id: "t1", approved: true },
    { id: "t2", approved: true },
    { id: "t3", approved: true },
    { id: "t4", approved: true },
  ];
  assert.deepEqual(summarizeApprovalChanges(requested, before, verified), {
    approved_count: 4,
    newly_approved_count: 1,
    already_approved_count: 2,
    approval_state_unknown_count: 1,
  });
});

test("summarizeApprovalChanges ignores rows that did not end approved", () => {
  const requested = [{ id: "t1", memo: "x" }];
  const before = new Map([["t1", { approved: false }]]);
  assert.deepEqual(summarizeApprovalChanges(requested, before, [{ id: "t1", approved: false }]), {
    approved_count: 0,
    newly_approved_count: 0,
    already_approved_count: 0,
    approval_state_unknown_count: 0,
  });
});

test("summarizeApprovalChanges matches composite scheduled ids to their before-state", () => {
  const requested = [{ id: "abc_2026-07-30", approved: true }];
  const before = new Map([["abc", { approved: false }]]);
  assert.equal(
    summarizeApprovalChanges(requested, before, [{ id: "abc", approved: true }]).newly_approved_count,
    1,
  );
});

test("decodeHtmlEntities decodes named and numeric references only", () => {
  assert.equal(decodeHtmlEntities("B&amp;H Photo Video"), "B&H Photo Video");
  assert.equal(decodeHtmlEntities("Ben &amp; Jerry&#39;s"), "Ben & Jerry's");
  assert.equal(decodeHtmlEntities("Caf&eacute; &#x2014; Montpelier"), "Café — Montpelier");
  // Bare ampersands and unknown entities are left exactly as they are.
  assert.equal(decodeHtmlEntities("AT&T"), "AT&T");
  assert.equal(decodeHtmlEntities("Tom &notanentity; Co"), "Tom &notanentity; Co");
  // Lone surrogates would break JSON serialization; leave them encoded.
  assert.equal(decodeHtmlEntities("&#xD800;"), "&#xD800;");
  assert.equal(decodeHtmlEntities(null), null);
  assert.equal(decodeHtmlEntities(42), 42);
});

test("decodeTextFieldsDeep rewrites only allow-listed text fields", () => {
  const payload = {
    id: "b&amp;h",
    csv: "payee\nB&amp;H",
    ready_to_approve: {
      by_payee: [{
        payee: "B&amp;H Photo Video",
        category_name: "Photo &amp; Video",
        transactions: [{ id: "t1", payee_name: "B&amp;H Photo Video", memo: "lens &amp; cap" }],
      }],
    },
  };
  decodeTextFieldsDeep(payload);
  assert.equal(payload.id, "b&amp;h", "ids are never rewritten");
  assert.equal(payload.csv, "payee\nB&amp;H", "raw payloads are never rewritten");
  assert.equal(payload.ready_to_approve.by_payee[0].payee, "B&H Photo Video");
  assert.equal(payload.ready_to_approve.by_payee[0].category_name, "Photo & Video");
  assert.equal(payload.ready_to_approve.by_payee[0].transactions[0].payee_name, "B&H Photo Video");
  assert.equal(payload.ready_to_approve.by_payee[0].transactions[0].memo, "lens & cap");
});

test("decodeTextFieldsDeep survives a cyclic payload", () => {
  const node = { name: "A &amp; B" };
  node.self = node;
  decodeTextFieldsDeep(node);
  assert.equal(node.name, "A & B");
});

test("normalizeSearchText folds case, entities, and whitespace", () => {
  assert.equal(normalizeSearchText("  B&amp;H   Photo  "), "b&h photo");
  assert.equal(normalizeSearchText(null), "");
});

const CATEGORY_GROUPS = [
  { name: "Health & Medical", hidden: false, deleted: false, categories: [
    { id: "c1", name: "🏊‍♂️ GMCF Membership", hidden: false, deleted: false },
    { id: "c2", name: "💊 Pharmacy", hidden: false, deleted: false },
  ] },
  { name: "Recreation", hidden: false, deleted: false, categories: [
    { id: "c3", name: "🚲 eBike", hidden: false, deleted: false },
    { id: "c4", name: "Gym Towels", hidden: false, deleted: false },
  ] },
  { name: "Archive", hidden: true, deleted: false, categories: [
    { id: "c5", name: "Old Gym", hidden: false, deleted: false },
  ] },
];

test("matchCategoriesByQuery ORs multi-word queries instead of failing them", () => {
  // "gym fitness membership" previously matched nothing; each word is tried.
  const ids = matchCategoriesByQuery(CATEGORY_GROUPS, "gym fitness membership").map((m) => m.category.id);
  assert.deepEqual(ids.slice().sort(), ["c1", "c4"]);
  const gmcf = matchCategoriesByQuery(CATEGORY_GROUPS, "gym fitness membership")
    .find((m) => m.category.id === "c1");
  assert.deepEqual(gmcf.matched_terms, ["membership"]);
  assert.deepEqual(gmcf.matched_on, ["name"]);
});

test("matchCategoriesByQuery searches group names as well as category names", () => {
  const matches = matchCategoriesByQuery(CATEGORY_GROUPS, "health");
  assert.deepEqual(matches.map((m) => m.category.id), ["c1", "c2"]);
  assert.deepEqual(matches[0].matched_on, ["group"]);
});

test("matchCategoriesByQuery ranks whole-phrase and name hits first", () => {
  const matches = matchCategoriesByQuery(CATEGORY_GROUPS, "gym towels");
  assert.equal(matches[0].category.id, "c4");
  assert.deepEqual(matches[0].matched_on, ["name"]);
});

test("matchCategoriesByQuery hides hidden groups unless asked", () => {
  assert.deepEqual(matchCategoriesByQuery(CATEGORY_GROUPS, "old").map((m) => m.category.id), []);
  assert.deepEqual(
    matchCategoriesByQuery(CATEGORY_GROUPS, "old", { includeHidden: true }).map((m) => m.category.id),
    ["c5"],
  );
});

test("matchCategoriesByQuery matches across entity escaping and empty queries", () => {
  const groups = [{ name: "Shopping", hidden: false, deleted: false, categories: [
    { id: "c9", name: "B&amp;H Photo", hidden: false, deleted: false },
  ] }];
  assert.deepEqual(matchCategoriesByQuery(groups, "b&h").map((m) => m.category.id), ["c9"]);
  assert.deepEqual(matchCategoriesByQuery(groups, "   "), []);
});

// --- Config parsing and field-length limits ---

test("envNumber falls back and warns for unparseable and out-of-range values", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    process.env.YNAB_UNIT_TEST_NUMBER = "not-a-number";
    assert.equal(envNumber("YNAB_UNIT_TEST_NUMBER", 42), 42);

    process.env.YNAB_UNIT_TEST_NUMBER = "-3";
    assert.equal(envNumber("YNAB_UNIT_TEST_NUMBER", 42, { min: 1 }), 42);

    process.env.YNAB_UNIT_TEST_NUMBER = "7";
    assert.equal(envNumber("YNAB_UNIT_TEST_NUMBER", 42), 7);

    // Zero is a documented setting for the timeout and retry knobs, so the
    // default min of 0 must accept it without a warning.
    process.env.YNAB_UNIT_TEST_NUMBER = "0";
    assert.equal(envNumber("YNAB_UNIT_TEST_NUMBER", 42), 0);

    delete process.env.YNAB_UNIT_TEST_NUMBER;
    assert.equal(envNumber("YNAB_UNIT_TEST_NUMBER", 42), 42);
  } finally {
    console.warn = originalWarn;
    delete process.env.YNAB_UNIT_TEST_NUMBER;
  }

  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /YNAB_UNIT_TEST_NUMBER: 'not-a-number' is not a number/);
  assert.match(warnings[1], /YNAB_UNIT_TEST_NUMBER: -3 is below the minimum of 1/);
});

test("write tool schemas enforce YNAB's documented field lengths", () => {
  const instance = createYnabServer({ hasCredentials: true, writesEnabled: true, journal: null });
  const parse = instance.internals.parseToolExecuteInput;

  // Category group name: YNAB caps SaveCategoryGroup.name at 50.
  parse("create_category_group", { name: "g".repeat(50) });
  assert.throws(
    () => parse("create_category_group", { name: "g".repeat(51) }),
    /Invalid input for create_category_group: name/,
  );
  assert.throws(
    () => parse("update_category_group", { categoryGroupId: "cg1", name: "g".repeat(51) }),
    /Invalid input for update_category_group: name/,
  );

  // Payee resource name: PostPayee and SavePayee cap name at 500.
  parse("create_payee", { name: "p".repeat(500) });
  assert.throws(
    () => parse("create_payee", { name: "p".repeat(501) }),
    /Invalid input for create_payee: name/,
  );

  // Transaction payee_name is capped at 200, not 500, by the same API.
  assert.throws(
    () => parse("create_transaction", {
      accountId: "a1", date: "2026-08-26", amount: -1, payeeName: "p".repeat(201),
    }),
    /Invalid input for create_transaction: payeeName/,
  );

  // Memo: SaveTransaction.memo is capped at 500.
  parse("create_transaction", {
    accountId: "a1", date: "2026-08-26", amount: -1, memo: "m".repeat(500),
  });
  assert.throws(
    () => parse("create_transaction", {
      accountId: "a1", date: "2026-08-26", amount: -1, memo: "m".repeat(501),
    }),
    /Invalid input for create_transaction: memo/,
  );
  assert.throws(
    () => parse("update_transaction", { transactionId: "t1", memo: "m".repeat(501) }),
    /Invalid input for update_transaction: memo/,
  );
});
