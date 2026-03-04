#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as ynab from "ynab";

// --- Init ---

const API_TOKEN = process.env.YNAB_API_TOKEN;
if (!API_TOKEN) {
  console.error("YNAB_API_TOKEN environment variable is required");
  process.exit(1);
}

const api = new ynab.API(API_TOKEN);
const DEFAULT_BUDGET_ID = process.env.YNAB_BUDGET_ID;

// --- Helpers ---

function resolveBudgetId(input) {
  const id = input || DEFAULT_BUDGET_ID;
  if (!id) throw new Error("budgetId is required (pass it or set YNAB_BUDGET_ID env var)");
  return id;
}

function dollars(milliunits) {
  return milliunits == null ? null : milliunits / 1000;
}

function milliunits(dollars) {
  return Math.round(dollars * 1000);
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    const msg = e?.error?.detail || e?.message || String(e);
    return { content: [{ type: "text", text: `Error: ${msg}` }] };
  }
}

// --- Server ---

const server = new McpServer({
  name: "ynab-mcp-server",
  version: "1.0.0",
});

// ==================== User & Budgets ====================

server.tool("get_user", "Get the authenticated user", {}, () =>
  run(async () => {
    const { data } = await api.user.getUser();
    return ok(data.user);
  })
);

server.tool("list_budgets", "List all budgets", {}, () =>
  run(async () => {
    const { data } = await api.budgets.getBudgets();
    return ok(data.budgets.map((b) => ({ id: b.id, name: b.name, last_modified_on: b.last_modified_on })));
  })
);

server.tool(
  "get_budget",
  "Get full budget details including accounts, categories, and payees",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.budgets.getBudgetById(resolveBudgetId(budgetId));
      const b = data.budget;
      return ok({
        id: b.id,
        name: b.name,
        currency_format: b.currency_format,
        accounts: b.accounts?.length,
        categories: b.categories?.length,
        payees: b.payees?.length,
      });
    })
);

server.tool(
  "get_budget_settings",
  "Get budget settings (currency format, date format)",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.budgets.getBudgetSettingsById(resolveBudgetId(budgetId));
      return ok(data.settings);
    })
);

// ==================== Accounts ====================

server.tool(
  "list_accounts",
  "List all accounts in a budget",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.accounts.getAccounts(resolveBudgetId(budgetId));
      return ok(
        data.accounts.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          on_budget: a.on_budget,
          closed: a.closed,
          balance: dollars(a.balance),
          cleared_balance: dollars(a.cleared_balance),
          uncleared_balance: dollars(a.uncleared_balance),
        }))
      );
    })
);

server.tool(
  "get_account",
  "Get details for a specific account",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    accountId: z.string().describe("Account ID"),
  },
  ({ budgetId, accountId }) =>
    run(async () => {
      const { data } = await api.accounts.getAccountById(resolveBudgetId(budgetId), accountId);
      const a = data.account;
      return ok({ ...a, balance: dollars(a.balance), cleared_balance: dollars(a.cleared_balance), uncleared_balance: dollars(a.uncleared_balance) });
    })
);

server.tool(
  "create_account",
  "Create a new account",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    name: z.string().describe("Account name"),
    type: z.enum(["checking", "savings", "cash", "creditCard", "lineOfCredit", "otherAsset", "otherLiability", "mortgage", "autoLoan", "studentLoan", "personalLoan", "medicalDebt", "otherDebt"]).describe("Account type"),
    balance: z.number().describe("Starting balance in dollars"),
  },
  ({ budgetId, name, type, balance: bal }) =>
    run(async () => {
      const { data } = await api.accounts.createAccount(resolveBudgetId(budgetId), {
        account: { name, type, balance: milliunits(bal) },
      });
      return ok(data.account);
    })
);

// ==================== Categories ====================

server.tool(
  "list_categories",
  "List all category groups and their categories",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.categories.getCategories(resolveBudgetId(budgetId));
      return ok(
        data.category_groups.map((g) => ({
          id: g.id,
          name: g.name,
          hidden: g.hidden,
          categories: g.categories.map((c) => ({
            id: c.id,
            name: c.name,
            hidden: c.hidden,
            budgeted: dollars(c.budgeted),
            activity: dollars(c.activity),
            balance: dollars(c.balance),
          })),
        }))
      );
    })
);

server.tool(
  "get_category",
  "Get a specific category",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryId: z.string().describe("Category ID"),
  },
  ({ budgetId, categoryId }) =>
    run(async () => {
      const { data } = await api.categories.getCategoryById(resolveBudgetId(budgetId), categoryId);
      const c = data.category;
      return ok({ ...c, budgeted: dollars(c.budgeted), activity: dollars(c.activity), balance: dollars(c.balance), goal_target: dollars(c.goal_target) });
    })
);

server.tool(
  "get_month_category",
  "Get category budget for a specific month",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
    categoryId: z.string().describe("Category ID"),
  },
  ({ budgetId, month, categoryId }) =>
    run(async () => {
      const { data } = await api.categories.getMonthCategoryById(resolveBudgetId(budgetId), month, categoryId);
      const c = data.category;
      return ok({ ...c, budgeted: dollars(c.budgeted), activity: dollars(c.activity), balance: dollars(c.balance) });
    })
);

server.tool(
  "update_month_category",
  "Set the budgeted amount for a category in a specific month",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
    categoryId: z.string().describe("Category ID"),
    budgeted: z.number().describe("Amount to budget in dollars"),
  },
  ({ budgetId, month, categoryId, budgeted }) =>
    run(async () => {
      const { data } = await api.categories.updateMonthCategory(resolveBudgetId(budgetId), month, categoryId, {
        category: { budgeted: milliunits(budgeted) },
      });
      const c = data.category;
      return ok({ ...c, budgeted: dollars(c.budgeted), activity: dollars(c.activity), balance: dollars(c.balance) });
    })
);

// ==================== Payees ====================

server.tool(
  "list_payees",
  "List all payees",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.payees.getPayees(resolveBudgetId(budgetId));
      return ok(data.payees.map((p) => ({ id: p.id, name: p.name, transfer_account_id: p.transfer_account_id })));
    })
);

server.tool(
  "get_payee",
  "Get a specific payee",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeId: z.string().describe("Payee ID"),
  },
  ({ budgetId, payeeId }) =>
    run(async () => {
      const { data } = await api.payees.getPayeeById(resolveBudgetId(budgetId), payeeId);
      return ok(data.payee);
    })
);

server.tool(
  "update_payee",
  "Rename a payee",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeId: z.string().describe("Payee ID"),
    name: z.string().describe("New payee name"),
  },
  ({ budgetId, payeeId, name }) =>
    run(async () => {
      const { data } = await api.payees.updatePayee(resolveBudgetId(budgetId), payeeId, {
        payee: { name },
      });
      return ok(data.payee);
    })
);

// ==================== Months ====================

server.tool(
  "list_months",
  "List all budget months",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.months.getBudgetMonths(resolveBudgetId(budgetId));
      return ok(
        data.months.map((m) => ({
          month: m.month,
          income: dollars(m.income),
          budgeted: dollars(m.budgeted),
          activity: dollars(m.activity),
          to_be_budgeted: dollars(m.to_be_budgeted),
        }))
      );
    })
);

server.tool(
  "get_month",
  "Get budget month detail with per-category breakdown",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
  },
  ({ budgetId, month }) =>
    run(async () => {
      const { data } = await api.months.getBudgetMonth(resolveBudgetId(budgetId), month);
      const m = data.month;
      return ok({
        month: m.month,
        income: dollars(m.income),
        budgeted: dollars(m.budgeted),
        activity: dollars(m.activity),
        to_be_budgeted: dollars(m.to_be_budgeted),
        categories: m.categories?.map((c) => ({
          id: c.id,
          name: c.name,
          budgeted: dollars(c.budgeted),
          activity: dollars(c.activity),
          balance: dollars(c.balance),
        })),
      });
    })
);

// ==================== Transactions ====================

function formatTransaction(t) {
  return {
    id: t.id,
    date: t.date,
    amount: dollars(t.amount),
    memo: t.memo,
    cleared: t.cleared,
    approved: t.approved,
    flag_color: t.flag_color,
    flag_name: t.flag_name,
    account_id: t.account_id,
    account_name: t.account_name,
    payee_id: t.payee_id,
    payee_name: t.payee_name,
    category_id: t.category_id,
    category_name: t.category_name,
    transfer_account_id: t.transfer_account_id,
    subtransactions: t.subtransactions?.map((s) => ({
      id: s.id,
      amount: dollars(s.amount),
      memo: s.memo,
      payee_id: s.payee_id,
      payee_name: s.payee_name,
      category_id: s.category_id,
      category_name: s.category_name,
    })),
  };
}

server.tool(
  "get_transactions",
  "Get transactions with optional filters. Use type='unapproved' or type='uncategorized' to filter. Optionally filter by account, category, payee, or month.",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    sinceDate: z.string().optional().describe("Only return transactions on or after this date (YYYY-MM-DD)"),
    type: z.enum(["unapproved", "uncategorized"]).optional().describe("Filter by approval/categorization status"),
    accountId: z.string().optional().describe("Filter by account ID"),
    categoryId: z.string().optional().describe("Filter by category ID"),
    payeeId: z.string().optional().describe("Filter by payee ID"),
    month: z.string().optional().describe("Filter by month (YYYY-MM-DD, first of month)"),
  },
  ({ budgetId, sinceDate, type, accountId, categoryId, payeeId, month }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      let transactions;

      if (accountId) {
        const { data } = await api.transactions.getTransactionsByAccount(bid, accountId, sinceDate, type);
        transactions = data.transactions;
      } else if (categoryId) {
        const { data } = await api.transactions.getTransactionsByCategory(bid, categoryId, sinceDate, type);
        transactions = data.transactions;
      } else if (payeeId) {
        const { data } = await api.transactions.getTransactionsByPayee(bid, payeeId, sinceDate, type);
        transactions = data.transactions;
      } else if (month) {
        // getTransactionsByMonth doesn't exist in SDK — use sinceDate filter
        const startDate = month;
        const [y, m] = month.split("-").map(Number);
        const endDate = new Date(y, m, 0).toISOString().slice(0, 10); // last day of month
        const { data } = await api.transactions.getTransactions(bid, startDate, type);
        transactions = data.transactions.filter((t) => t.date <= endDate);
      } else {
        const { data } = await api.transactions.getTransactions(bid, sinceDate, type);
        transactions = data.transactions;
      }

      return ok(transactions.map(formatTransaction));
    })
);

server.tool(
  "get_transaction",
  "Get a single transaction by ID",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("Transaction ID"),
  },
  ({ budgetId, transactionId }) =>
    run(async () => {
      const { data } = await api.transactions.getTransactionById(resolveBudgetId(budgetId), transactionId);
      return ok(formatTransaction(data.transaction));
    })
);

server.tool(
  "create_transaction",
  "Create a new transaction. Amounts are in dollars (positive for inflows, negative for outflows).",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    accountId: z.string().describe("Account ID"),
    date: z.string().describe("Transaction date (YYYY-MM-DD)"),
    amount: z.number().describe("Amount in dollars (negative for outflows, positive for inflows)"),
    payeeId: z.string().optional().describe("Payee ID"),
    payeeName: z.string().optional().describe("Payee name (creates new payee if no payeeId)"),
    categoryId: z.string().optional().describe("Category ID"),
    memo: z.string().optional().describe("Transaction memo"),
    cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
    approved: z.boolean().optional().describe("Whether transaction is approved"),
    flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).optional().describe("Flag color"),
  },
  ({ budgetId, accountId, date, amount, payeeId, payeeName, categoryId, memo, cleared, approved, flagColor }) =>
    run(async () => {
      const { data } = await api.transactions.createTransaction(resolveBudgetId(budgetId), {
        transaction: {
          account_id: accountId,
          date,
          amount: milliunits(amount),
          payee_id: payeeId,
          payee_name: payeeName,
          category_id: categoryId,
          memo,
          cleared,
          approved,
          flag_color: flagColor,
        },
      });
      return ok(formatTransaction(data.transaction));
    })
);

server.tool(
  "update_transaction",
  "Update an existing transaction. Only provided fields are changed. Amounts in dollars.",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("Transaction ID"),
    accountId: z.string().optional().describe("Account ID"),
    date: z.string().optional().describe("Transaction date (YYYY-MM-DD)"),
    amount: z.number().optional().describe("Amount in dollars"),
    payeeId: z.string().optional().describe("Payee ID"),
    payeeName: z.string().optional().describe("Payee name"),
    categoryId: z.string().nullable().optional().describe("Category ID (null to uncategorize)"),
    memo: z.string().optional().describe("Transaction memo"),
    cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
    approved: z.boolean().optional().describe("Whether transaction is approved"),
    flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).nullable().optional().describe("Flag color (null to remove)"),
  },
  ({ budgetId, transactionId, accountId, date, amount, payeeId, payeeName, categoryId, memo, cleared, approved, flagColor }) =>
    run(async () => {
      const txn = {};
      if (accountId !== undefined) txn.account_id = accountId;
      if (date !== undefined) txn.date = date;
      if (amount !== undefined) txn.amount = milliunits(amount);
      if (payeeId !== undefined) txn.payee_id = payeeId;
      if (payeeName !== undefined) txn.payee_name = payeeName;
      if (categoryId !== undefined) txn.category_id = categoryId;
      if (memo !== undefined) txn.memo = memo;
      if (cleared !== undefined) txn.cleared = cleared;
      if (approved !== undefined) txn.approved = approved;
      if (flagColor !== undefined) txn.flag_color = flagColor;

      const { data } = await api.transactions.updateTransaction(resolveBudgetId(budgetId), transactionId, {
        transaction: txn,
      });
      return ok(formatTransaction(data.transaction));
    })
);

server.tool(
  "delete_transaction",
  "Delete a transaction",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("Transaction ID"),
  },
  ({ budgetId, transactionId }) =>
    run(async () => {
      const { data } = await api.transactions.deleteTransaction(resolveBudgetId(budgetId), transactionId);
      return ok(data.transaction);
    })
);

server.tool(
  "update_transactions",
  "Batch update multiple transactions. Each transaction object must include its id and the fields to update.",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactions: z
      .array(
        z.object({
          id: z.string().describe("Transaction ID"),
          account_id: z.string().optional(),
          date: z.string().optional(),
          amount: z.number().optional().describe("Amount in dollars"),
          payee_id: z.string().optional(),
          payee_name: z.string().optional(),
          category_id: z.string().optional(),
          memo: z.string().optional(),
          cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional(),
          approved: z.boolean().optional(),
          flag_color: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).nullable().optional(),
        })
      )
      .describe("Array of transaction updates"),
  },
  ({ budgetId, transactions: txns }) =>
    run(async () => {
      const mapped = txns.map((t) => {
        const out = { ...t };
        if (out.amount !== undefined) out.amount = milliunits(out.amount);
        return out;
      });
      const { data } = await api.transactions.updateTransactions(resolveBudgetId(budgetId), {
        transactions: mapped,
      });
      return ok({
        updated: data.transactions?.map(formatTransaction),
        duplicate_import_ids: data.duplicate_import_ids,
      });
    })
);

server.tool(
  "import_transactions",
  "Trigger import of linked account transactions",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.transactions.importTransactions(resolveBudgetId(budgetId));
      return ok(data);
    })
);

// ==================== Scheduled Transactions ====================

function formatScheduledTransaction(t) {
  return {
    id: t.id,
    date_first: t.date_first,
    date_next: t.date_next,
    frequency: t.frequency,
    amount: dollars(t.amount),
    memo: t.memo,
    flag_color: t.flag_color,
    flag_name: t.flag_name,
    account_id: t.account_id,
    account_name: t.account_name,
    payee_id: t.payee_id,
    payee_name: t.payee_name,
    category_id: t.category_id,
    category_name: t.category_name,
  };
}

server.tool(
  "list_scheduled_transactions",
  "List all scheduled (recurring) transactions",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.scheduledTransactions.getScheduledTransactions(resolveBudgetId(budgetId));
      return ok(data.scheduled_transactions.map(formatScheduledTransaction));
    })
);

server.tool(
  "get_scheduled_transaction",
  "Get a specific scheduled transaction",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    scheduledTransactionId: z.string().describe("Scheduled transaction ID"),
  },
  ({ budgetId, scheduledTransactionId }) =>
    run(async () => {
      const { data } = await api.scheduledTransactions.getScheduledTransactionById(resolveBudgetId(budgetId), scheduledTransactionId);
      return ok(formatScheduledTransaction(data.scheduled_transaction));
    })
);

server.tool(
  "create_scheduled_transaction",
  "Create a new scheduled (recurring) transaction",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    accountId: z.string().describe("Account ID"),
    dateFirst: z.string().describe("First occurrence date (YYYY-MM-DD)"),
    frequency: z.enum(["never", "daily", "weekly", "everyOtherWeek", "twiceAMonth", "every4Weeks", "monthly", "everyOtherMonth", "every3Months", "every4Months", "twiceAYear", "yearly", "everyOtherYear"]).describe("Recurrence frequency"),
    amount: z.number().describe("Amount in dollars (negative for outflows)"),
    payeeId: z.string().optional().describe("Payee ID"),
    payeeName: z.string().optional().describe("Payee name"),
    categoryId: z.string().optional().describe("Category ID"),
    memo: z.string().optional().describe("Memo"),
    flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).optional().describe("Flag color"),
  },
  ({ budgetId, accountId, dateFirst, frequency, amount, payeeId, payeeName, categoryId, memo, flagColor }) =>
    run(async () => {
      const { data } = await api.scheduledTransactions.createScheduledTransaction(resolveBudgetId(budgetId), {
        scheduled_transaction: {
          account_id: accountId,
          date: dateFirst,
          frequency,
          amount: milliunits(amount),
          payee_id: payeeId,
          payee_name: payeeName,
          category_id: categoryId,
          memo,
          flag_color: flagColor,
        },
      });
      return ok(formatScheduledTransaction(data.scheduled_transaction));
    })
);

server.tool(
  "delete_scheduled_transaction",
  "Delete a scheduled transaction",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    scheduledTransactionId: z.string().describe("Scheduled transaction ID"),
  },
  ({ budgetId, scheduledTransactionId }) =>
    run(async () => {
      const { data } = await api.scheduledTransactions.deleteScheduledTransaction(resolveBudgetId(budgetId), scheduledTransactionId);
      return ok(data.scheduled_transaction);
    })
);

// ==================== Convenience Tools ====================

server.tool(
  "search_categories",
  "Search categories by partial name match (case-insensitive). Useful for finding category IDs when you only know part of the name.",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    query: z.string().describe("Partial category name to search for (e.g. 'work' matches '💻 Work Expenses (Oliver LLC)')"),
  },
  ({ budgetId, query }) =>
    run(async () => {
      const { data } = await api.categories.getCategories(resolveBudgetId(budgetId));
      const q = query.toLowerCase();
      const matches = [];
      for (const g of data.category_groups) {
        if (g.hidden) continue;
        for (const c of g.categories) {
          if (c.hidden) continue;
          if (c.name.toLowerCase().includes(q)) {
            matches.push({
              id: c.id,
              name: c.name,
              group: g.name,
              budgeted: dollars(c.budgeted),
              activity: dollars(c.activity),
              balance: dollars(c.balance),
            });
          }
        }
      }
      if (matches.length === 0) return ok({ message: `No categories matching "${query}"`, suggestions: "Try a shorter search term" });
      return ok(matches);
    })
);

server.tool(
  "search_payees",
  "Search payees by partial name match (case-insensitive). Useful for finding payee IDs.",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    query: z.string().describe("Partial payee name to search for"),
  },
  ({ budgetId, query }) =>
    run(async () => {
      const { data } = await api.payees.getPayees(resolveBudgetId(budgetId));
      const q = query.toLowerCase();
      const matches = data.payees
        .filter((p) => p.name.toLowerCase().includes(q))
        .map((p) => ({ id: p.id, name: p.name, transfer_account_id: p.transfer_account_id }));
      if (matches.length === 0) return ok({ message: `No payees matching "${query}"` });
      return ok(matches);
    })
);

server.tool(
  "review_unapproved",
  "Get all unapproved transactions grouped by status: those already categorized (ready to approve) and those still uncategorized (need category first). Never approve uncategorized transactions without explicit user instruction.",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.transactions.getTransactions(resolveBudgetId(budgetId), undefined, "unapproved");
      const txns = data.transactions.map(formatTransaction);
      const categorized = txns.filter((t) => t.category_id && t.category_name !== "Uncategorized");
      const uncategorized = txns.filter((t) => !t.category_id || t.category_name === "Uncategorized");
      return ok({
        total: txns.length,
        ready_to_approve: {
          count: categorized.length,
          transactions: categorized,
        },
        needs_category_first: {
          count: uncategorized.length,
          warning: "Do NOT approve these without assigning a category first",
          transactions: uncategorized,
        },
      });
    })
);

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
