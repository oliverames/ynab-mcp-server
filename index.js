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
  const id = input || DEFAULT_BUDGET_ID || "last-used";
  return id;
}

function dollars(milliunits) {
  return milliunits == null ? null : milliunits / 1000;
}

function milliunits(dollars) {
  return Math.round(dollars * 1000);
}

function dollarsMap(obj) {
  return obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, dollars(v)])) : obj;
}

function mapTransactionInput(t) {
  const out = {
    account_id: t.accountId,
    date: t.date,
    amount: milliunits(t.amount),
    payee_id: t.payeeId,
    payee_name: t.payeeName,
    category_id: t.categoryId,
    memo: t.memo,
    cleared: t.cleared,
    approved: t.approved,
    flag_color: t.flagColor,
    import_id: t.importId,
  };
  if (t.subtransactions) {
    out.subtransactions = t.subtransactions.map((s) => ({
      amount: milliunits(s.amount),
      category_id: s.categoryId,
      payee_id: s.payeeId,
      payee_name: s.payeeName,
      memo: s.memo,
    }));
  }
  return out;
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    const detail = e?.error?.detail;
    const name = e?.error?.name;
    const msg = detail
      ? (name ? `${name}: ${detail}` : detail)
      : (e?.message || String(e));
    return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
  }
}

// Direct API helper for endpoints not yet in the ynab SDK
const BASE_URL = "https://api.ynab.com/v1";
async function ynabFetch(path, { method = "GET", body } = {}) {
  const opts = {
    method,
    headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const json = await res.json();
  if (!res.ok) {
    const err = new Error(json?.error?.detail || `HTTP ${res.status}`);
    err.error = json?.error;
    throw err;
  }
  return json.data;
}

// --- Server ---

const server = new McpServer({
  name: "ynab-mcp-server",
  version: "1.2.1",
});

// ==================== User & Budgets ====================

server.tool("get_user", "Get the authenticated user", {}, () =>
  run(async () => {
    const { data } = await api.user.getUser();
    return ok(data.user);
  })
);

server.tool("list_budgets", "List all budgets. Use a budget ID from the results in other tools, or omit budgetId to use the last-used budget.", {}, () =>
  run(async () => {
    const { data } = await api.budgets.getBudgets();
    const result = {
      budgets: data.budgets.map((b) => ({ id: b.id, name: b.name, last_modified_on: b.last_modified_on, first_month: b.first_month, last_month: b.last_month, date_format: b.date_format, currency_format: b.currency_format })),
    };
    if (data.default_budget) {
      result.default_budget = { id: data.default_budget.id, name: data.default_budget.name };
    }
    return ok(result);
  })
);

server.tool(
  "get_budget",
  "Get a budget summary including name, currency format, and account/category/payee counts",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.budgets.getBudgetById(resolveBudgetId(budgetId));
      const b = data.budget;
      return ok({
        id: b.id,
        name: b.name,
        last_modified_on: b.last_modified_on,
        first_month: b.first_month,
        last_month: b.last_month,
        date_format: b.date_format,
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

function formatAccount(a) {
  const out = {
    id: a.id,
    name: a.name,
    type: a.type,
    on_budget: a.on_budget,
    closed: a.closed,
    balance: dollars(a.balance),
    cleared_balance: dollars(a.cleared_balance),
    uncleared_balance: dollars(a.uncleared_balance),
    transfer_payee_id: a.transfer_payee_id,
    direct_import_linked: a.direct_import_linked,
    direct_import_in_error: a.direct_import_in_error,
    last_reconciled_at: a.last_reconciled_at,
    debt_original_balance: dollars(a.debt_original_balance),
    debt_interest_rates: a.debt_interest_rates,
    debt_minimum_payments: dollarsMap(a.debt_minimum_payments),
    debt_escrow_amounts: dollarsMap(a.debt_escrow_amounts),
    deleted: a.deleted,
  };
  if ("note" in a) out.note = a.note;
  return out;
}

server.tool(
  "list_accounts",
  "List all accounts in a budget",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.accounts.getAccounts(resolveBudgetId(budgetId));
      return ok(data.accounts.map(formatAccount));
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
      return ok(formatAccount(data.account));
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
      return ok(formatAccount(data.account));
    })
);

// ==================== Categories ====================

function formatCategory(c) {
  return {
    id: c.id,
    category_group_id: c.category_group_id,
    category_group_name: c.category_group_name,
    original_category_group_id: c.original_category_group_id,
    name: c.name,
    hidden: c.hidden,
    note: c.note,
    budgeted: dollars(c.budgeted),
    activity: dollars(c.activity),
    balance: dollars(c.balance),
    goal_type: c.goal_type,
    goal_day: c.goal_day,
    goal_cadence: c.goal_cadence,
    goal_cadence_frequency: c.goal_cadence_frequency,
    goal_creation_month: c.goal_creation_month,
    goal_target: dollars(c.goal_target),
    goal_target_date: c.goal_target_date,
    goal_percentage_complete: c.goal_percentage_complete,
    goal_months_to_budget: c.goal_months_to_budget,
    goal_under_funded: dollars(c.goal_under_funded),
    goal_overall_funded: dollars(c.goal_overall_funded),
    goal_overall_left: dollars(c.goal_overall_left),
    goal_needs_whole_amount: c.goal_needs_whole_amount,
    deleted: c.deleted,
  };
}

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
          deleted: g.deleted,
          categories: g.categories.map((c) => ({
            id: c.id,
            name: c.name,
            hidden: c.hidden,
            budgeted: dollars(c.budgeted),
            activity: dollars(c.activity),
            balance: dollars(c.balance),
            goal_type: c.goal_type,
            deleted: c.deleted,
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
      return ok(formatCategory(data.category));
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
      return ok(formatCategory(data.category));
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
      return ok(formatCategory(data.category));
    })
);

server.tool(
  "update_category",
  "Update a category's name, note, goal target, or move it to a different group",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryId: z.string().describe("Category ID"),
    name: z.string().optional().describe("New category name"),
    note: z.string().nullable().optional().describe("Category note (null to clear)"),
    categoryGroupId: z.string().optional().describe("Move to a different category group"),
    goalTarget: z.number().nullable().optional().describe("Goal target amount in dollars (only if category already has a goal)"),
    goalTargetDate: z.string().nullable().optional().describe("Goal target date in ISO format (e.g. 2026-12-01, null to clear)"),
  },
  ({ budgetId, categoryId, name, note, categoryGroupId, goalTarget, goalTargetDate }) =>
    run(async () => {
      const cat = {};
      if (name !== undefined) cat.name = name;
      if (note !== undefined) cat.note = note;
      if (categoryGroupId !== undefined) cat.category_group_id = categoryGroupId;
      if (goalTarget !== undefined) cat.goal_target = goalTarget != null ? milliunits(goalTarget) : null;
      if (goalTargetDate !== undefined) cat.goal_target_date = goalTargetDate;

      const { data } = await api.categories.updateCategory(resolveBudgetId(budgetId), categoryId, {
        category: cat,
      });
      return ok(formatCategory(data.category));
    })
);

server.tool(
  "create_category",
  "Create a new category in a category group",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryGroupId: z.string().describe("Category group ID to create the category in"),
    name: z.string().describe("Category name"),
    note: z.string().optional().describe("Category note"),
    goalTarget: z.number().optional().describe("Goal target amount in dollars (creates a 'Needed for Spending' goal)"),
    goalTargetDate: z.string().optional().describe("Goal target date in ISO format (e.g. 2026-12-01)"),
  },
  ({ budgetId, categoryGroupId, name, note, goalTarget, goalTargetDate }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const cat = { category_group_id: categoryGroupId, name };
      if (note !== undefined) cat.note = note;
      if (goalTarget !== undefined) cat.goal_target = milliunits(goalTarget);
      if (goalTargetDate !== undefined) cat.goal_target_date = goalTargetDate;
      const data = await ynabFetch(`/budgets/${bid}/categories`, {
        method: "POST",
        body: { category: cat },
      });
      return ok(formatCategory(data.category));
    })
);

server.tool(
  "create_category_group",
  "Create a new category group",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    name: z.string().describe("Category group name (max 50 characters)"),
  },
  ({ budgetId, name }) =>
    run(async () => {
      const data = await ynabFetch(`/budgets/${resolveBudgetId(budgetId)}/category_groups`, {
        method: "POST",
        body: { category_group: { name } },
      });
      return ok(data.category_group);
    })
);

server.tool(
  "update_category_group",
  "Rename a category group",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryGroupId: z.string().describe("Category group ID"),
    name: z.string().describe("New category group name (max 50 characters)"),
  },
  ({ budgetId, categoryGroupId, name }) =>
    run(async () => {
      const data = await ynabFetch(`/budgets/${resolveBudgetId(budgetId)}/category_groups/${categoryGroupId}`, {
        method: "PATCH",
        body: { category_group: { name } },
      });
      return ok(data.category_group);
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
      return ok(data.payees.map((p) => ({ id: p.id, name: p.name, transfer_account_id: p.transfer_account_id, deleted: p.deleted })));
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

// ==================== Payee Locations ====================

server.tool(
  "list_payee_locations",
  "List all payee locations (GPS coordinates where transactions occurred)",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.payeeLocations.getPayeeLocations(resolveBudgetId(budgetId));
      return ok(data.payee_locations);
    })
);

server.tool(
  "get_payee_location",
  "Get a specific payee location",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeLocationId: z.string().describe("Payee location ID"),
  },
  ({ budgetId, payeeLocationId }) =>
    run(async () => {
      const { data } = await api.payeeLocations.getPayeeLocationById(resolveBudgetId(budgetId), payeeLocationId);
      return ok(data.payee_location);
    })
);

server.tool(
  "get_payee_locations_by_payee",
  "Get all locations for a specific payee",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeId: z.string().describe("Payee ID"),
  },
  ({ budgetId, payeeId }) =>
    run(async () => {
      const { data } = await api.payeeLocations.getPayeeLocationsByPayee(resolveBudgetId(budgetId), payeeId);
      return ok(data.payee_locations);
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
          note: m.note,
          income: dollars(m.income),
          budgeted: dollars(m.budgeted),
          activity: dollars(m.activity),
          to_be_budgeted: dollars(m.to_be_budgeted),
          age_of_money: m.age_of_money,
          deleted: m.deleted,
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
        note: m.note,
        income: dollars(m.income),
        budgeted: dollars(m.budgeted),
        activity: dollars(m.activity),
        to_be_budgeted: dollars(m.to_be_budgeted),
        age_of_money: m.age_of_money,
        deleted: m.deleted,
        categories: m.categories?.map((c) => ({
          id: c.id,
          name: c.name,
          hidden: c.hidden,
          category_group_name: c.category_group_name,
          budgeted: dollars(c.budgeted),
          activity: dollars(c.activity),
          balance: dollars(c.balance),
          goal_type: c.goal_type,
          goal_target: dollars(c.goal_target),
          goal_under_funded: dollars(c.goal_under_funded),
          deleted: c.deleted,
        })),
      });
    })
);

// ==================== Money Movements ====================

function formatMoneyMovement(m) {
  return {
    id: m.id,
    month: m.month,
    moved_at: m.moved_at,
    note: m.note,
    money_movement_group_id: m.money_movement_group_id,
    performed_by_user_id: m.performed_by_user_id,
    from_category_id: m.from_category_id,
    to_category_id: m.to_category_id,
    amount: dollars(m.amount),
    deleted: m.deleted,
  };
}

server.tool(
  "list_money_movements",
  "List all money movements (budget re-allocations between categories)",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const data = await ynabFetch(`/budgets/${resolveBudgetId(budgetId)}/money_movements`);
      return ok(data.money_movements.map(formatMoneyMovement));
    })
);

server.tool(
  "get_money_movements_by_month",
  "Get money movements for a specific month",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month), or 'current'"),
  },
  ({ budgetId, month }) =>
    run(async () => {
      const data = await ynabFetch(`/budgets/${resolveBudgetId(budgetId)}/months/${month}/money_movements`);
      return ok(data.money_movements.map(formatMoneyMovement));
    })
);

server.tool(
  "list_money_movement_groups",
  "List all money movement groups (batches of related money movements)",
  { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") },
  ({ budgetId }) =>
    run(async () => {
      const data = await ynabFetch(`/budgets/${resolveBudgetId(budgetId)}/money_movement_groups`);
      return ok(data.money_movement_groups);
    })
);

server.tool(
  "get_money_movement_groups_by_month",
  "Get money movement groups for a specific month",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month), or 'current'"),
  },
  ({ budgetId, month }) =>
    run(async () => {
      const data = await ynabFetch(`/budgets/${resolveBudgetId(budgetId)}/months/${month}/money_movement_groups`);
      return ok(data.money_movement_groups);
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
    transfer_transaction_id: t.transfer_transaction_id,
    matched_transaction_id: t.matched_transaction_id,
    import_id: t.import_id,
    import_payee_name: t.import_payee_name,
    import_payee_name_original: t.import_payee_name_original,
    debt_transaction_type: t.debt_transaction_type,
    deleted: t.deleted,
    subtransactions: t.subtransactions?.map((s) => ({
      id: s.id,
      transaction_id: s.transaction_id,
      amount: dollars(s.amount),
      memo: s.memo,
      payee_id: s.payee_id,
      payee_name: s.payee_name,
      category_id: s.category_id,
      category_name: s.category_name,
      transfer_account_id: s.transfer_account_id,
      transfer_transaction_id: s.transfer_transaction_id,
      deleted: s.deleted,
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
        const { data } = await api.transactions.getTransactionsByMonth(bid, month, sinceDate, type);
        transactions = data.transactions;
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
  "Create a new transaction. Amounts are in dollars (positive for inflows, negative for outflows). Note: future-dated transactions cannot be created here — use create_scheduled_transaction instead.",
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
    importId: z.string().optional().describe("Unique import ID for deduplication (max 36 chars). If omitted and the transaction is later imported, duplicates may be created."),
    subtransactions: z.array(z.object({
      amount: z.number().describe("Subtransaction amount in dollars"),
      categoryId: z.string().optional().describe("Category ID"),
      payeeId: z.string().optional().describe("Payee ID"),
      payeeName: z.string().optional().describe("Payee name"),
      memo: z.string().optional().describe("Memo"),
    })).optional().describe("Split transaction into subtransactions. The subtransaction amounts must sum to the total transaction amount."),
  },
  ({ budgetId, ...txnFields }) =>
    run(async () => {
      const { data } = await api.transactions.createTransaction(resolveBudgetId(budgetId), {
        transaction: mapTransactionInput(txnFields),
      });
      return ok(formatTransaction(data.transaction));
    })
);

server.tool(
  "create_transactions",
  "Create multiple transactions at once. Amounts are in dollars. Returns created transactions and any duplicate import IDs. Future-dated transactions are not supported — use create_scheduled_transaction instead.",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactions: z.array(z.object({
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
      importId: z.string().optional().describe("Unique import ID for deduplication (max 36 chars)"),
      subtransactions: z.array(z.object({
        amount: z.number().describe("Subtransaction amount in dollars"),
        categoryId: z.string().optional().describe("Category ID"),
        payeeId: z.string().optional().describe("Payee ID"),
        payeeName: z.string().optional().describe("Payee name"),
        memo: z.string().optional().describe("Memo"),
      })).optional().describe("Split transaction into subtransactions"),
    })).describe("Array of transactions to create"),
  },
  ({ budgetId, transactions: txns }) =>
    run(async () => {
      const { data } = await api.transactions.createTransactions(resolveBudgetId(budgetId), {
        transactions: txns.map(mapTransactionInput),
      });
      return ok({
        created: data.transactions?.map(formatTransaction),
        duplicate_import_ids: data.duplicate_import_ids,
      });
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
    payeeId: z.string().nullable().optional().describe("Payee ID (null to remove)"),
    payeeName: z.string().nullable().optional().describe("Payee name (null to clear)"),
    categoryId: z.string().nullable().optional().describe("Category ID (null to uncategorize)"),
    memo: z.string().nullable().optional().describe("Transaction memo (null to clear)"),
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
      return ok(formatTransaction(data.transaction));
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
          accountId: z.string().optional().describe("Account ID"),
          date: z.string().optional().describe("Transaction date (YYYY-MM-DD)"),
          amount: z.number().optional().describe("Amount in dollars"),
          payeeId: z.string().nullable().optional().describe("Payee ID (null to remove)"),
          payeeName: z.string().nullable().optional().describe("Payee name (null to clear)"),
          categoryId: z.string().nullable().optional().describe("Category ID (null to uncategorize)"),
          memo: z.string().nullable().optional().describe("Transaction memo (null to clear)"),
          cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
          approved: z.boolean().optional().describe("Whether transaction is approved"),
          flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).nullable().optional().describe("Flag color (null to remove)"),
        })
      )
      .describe("Array of transaction updates"),
  },
  ({ budgetId, transactions: txns }) =>
    run(async () => {
      const mapped = txns.map((t) => {
        const out = { id: t.id };
        if (t.accountId !== undefined) out.account_id = t.accountId;
        if (t.date !== undefined) out.date = t.date;
        if (t.amount !== undefined) out.amount = milliunits(t.amount);
        if (t.payeeId !== undefined) out.payee_id = t.payeeId;
        if (t.payeeName !== undefined) out.payee_name = t.payeeName;
        if (t.categoryId !== undefined) out.category_id = t.categoryId;
        if (t.memo !== undefined) out.memo = t.memo;
        if (t.cleared !== undefined) out.cleared = t.cleared;
        if (t.approved !== undefined) out.approved = t.approved;
        if (t.flagColor !== undefined) out.flag_color = t.flagColor;
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
    transfer_account_id: t.transfer_account_id,
    deleted: t.deleted,
    subtransactions: t.subtransactions?.map((s) => ({
      id: s.id,
      scheduled_transaction_id: s.scheduled_transaction_id,
      amount: dollars(s.amount),
      memo: s.memo,
      payee_id: s.payee_id,
      payee_name: s.payee_name,
      category_id: s.category_id,
      category_name: s.category_name,
      transfer_account_id: s.transfer_account_id,
      deleted: s.deleted,
    })),
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
  "update_scheduled_transaction",
  "Update an existing scheduled transaction. Only provided fields are changed. Amounts in dollars.",
  {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    scheduledTransactionId: z.string().describe("Scheduled transaction ID"),
    accountId: z.string().optional().describe("Account ID"),
    date: z.string().optional().describe("Next occurrence date (YYYY-MM-DD)"),
    frequency: z.enum(["never", "daily", "weekly", "everyOtherWeek", "twiceAMonth", "every4Weeks", "monthly", "everyOtherMonth", "every3Months", "every4Months", "twiceAYear", "yearly", "everyOtherYear"]).optional().describe("Recurrence frequency"),
    amount: z.number().optional().describe("Amount in dollars (negative for outflows)"),
    payeeId: z.string().nullable().optional().describe("Payee ID"),
    payeeName: z.string().nullable().optional().describe("Payee name"),
    categoryId: z.string().nullable().optional().describe("Category ID"),
    memo: z.string().nullable().optional().describe("Memo"),
    flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).nullable().optional().describe("Flag color"),
  },
  ({ budgetId, scheduledTransactionId, accountId, date, frequency, amount, payeeId, payeeName, categoryId, memo, flagColor }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      // PUT replaces the full resource — fetch current values to merge with updates
      const { data: current } = await api.scheduledTransactions.getScheduledTransactionById(bid, scheduledTransactionId);
      const existing = current.scheduled_transaction;

      const st = {
        account_id: accountId ?? existing.account_id,
        date: date ?? existing.date_next,
        frequency: frequency ?? existing.frequency,
        amount: amount !== undefined ? milliunits(amount) : existing.amount,
        payee_id: payeeId !== undefined ? payeeId : existing.payee_id,
        payee_name: payeeName !== undefined ? payeeName : existing.payee_name,
        category_id: categoryId !== undefined ? categoryId : existing.category_id,
        memo: memo !== undefined ? memo : existing.memo,
        flag_color: flagColor !== undefined ? flagColor : existing.flag_color,
      };

      const { data } = await api.scheduledTransactions.updateScheduledTransaction(
        bid,
        scheduledTransactionId,
        { scheduled_transaction: st }
      );
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
      return ok(formatScheduledTransaction(data.scheduled_transaction));
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
        .map((p) => ({ id: p.id, name: p.name, transfer_account_id: p.transfer_account_id, deleted: p.deleted }));
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
      const isCategorized = (t) => (t.category_id && t.category_name !== "Uncategorized")
        || (t.subtransactions && t.subtransactions.length > 0) // split transactions are categorized via subtransactions
        || t.transfer_account_id; // transfers don't need categories
      const categorized = txns.filter(isCategorized);
      const uncategorized = txns.filter((t) => !isCategorized(t));
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

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

const transport = new StdioServerTransport();
await server.connect(transport);
