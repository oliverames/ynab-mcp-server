#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as ynab from "ynab";

// --- Init ---

const BASE_URL = "https://api.ynab.com/v1";
const YNAB_API_HOST = "api.ynab.com";
const MAX_TOKEN_FILE_BYTES = 4096;
const MAX_RESPONSE_BYTES = Number.parseInt(process.env.YNAB_MAX_RESPONSE_BYTES || "8388608", 10);

let API_TOKEN = process.env.YNAB_API_TOKEN;
let tokenLookupError;
if (!API_TOKEN && process.env.YNAB_API_TOKEN_FILE) {
  try {
    const tokenFileContents = readFileSync(process.env.YNAB_API_TOKEN_FILE, "utf8");
    if (Buffer.byteLength(tokenFileContents, "utf8") > MAX_TOKEN_FILE_BYTES) {
      throw new Error(`token file exceeds ${MAX_TOKEN_FILE_BYTES} bytes`);
    }
    API_TOKEN = tokenFileContents.trim();
  } catch (e) {
    tokenLookupError = `Could not read YNAB_API_TOKEN_FILE: ${e.message || String(e)}`;
  }
}
if (!API_TOKEN && process.env.YNAB_OP_PATH) {
  try {
    API_TOKEN = execFileSync(
      "op", ["read", process.env.YNAB_OP_PATH],
      { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  } catch (e) {
    tokenLookupError = `Could not read YNAB_OP_PATH via 1Password CLI: ${e.stderr?.toString().trim() || e.message || "unknown 1Password CLI error"}`;
  }
}
if (!API_TOKEN) {
  const fallbackMessage = tokenLookupError
    ? ` ${tokenLookupError}.`
    : " Set YNAB_API_TOKEN_FILE or YNAB_OP_PATH to enable token fallback.";
  console.error(`YNAB_API_TOKEN environment variable is required.${fallbackMessage} Starting MCP Server for YNAB in discovery-only mode.`);
}

const ynabRateLimit = createYnabRateLimiter();
const effectiveApiToken = API_TOKEN || "missing-token-for-tool-discovery";
const api = new ynab.API(effectiveApiToken, BASE_URL);
api._configuration.config = { accessToken: effectiveApiToken, basePath: BASE_URL, fetchApi: secureFetch };
const DEFAULT_BUDGET_ID = process.env.YNAB_BUDGET_ID;

// --- Helpers ---

function resolveBudgetId(input) {
  return input || DEFAULT_BUDGET_ID || "last-used";
}

function dollars(milliunits) {
  return milliunits == null ? null : milliunits / 1000;
}

function milliunits(dollars) {
  return Math.round(dollars * 1000);
}

// Round a dollar sum to cents, killing IEEE-754 artifacts from summing floats
// (e.g. a group total like -53.730000000000004 produced by reduce/+= over amounts).
function round2(n) {
  return n == null ? n : Math.round(n * 100) / 100;
}

function dollarsMap(obj) {
  return obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, dollars(v)])) : obj;
}

function withCurrencyFields(out, source, fields) {
  for (const field of fields) {
    const formatted = `${field}_formatted`;
    const currency = `${field}_currency`;
    if (formatted in source) out[formatted] = source[formatted];
    if (currency in source) out[currency] = source[currency];
  }
  return out;
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

// Sparse patch mapper for update_transaction / update_transactions - only includes fields that were explicitly provided
function mapTransactionUpdate(t) {
  const out = {};
  if (t.accountId  !== undefined) out.account_id  = t.accountId;
  if (t.date       !== undefined) out.date         = t.date;
  if (t.amount     !== undefined) out.amount        = milliunits(t.amount);
  if (t.payeeId    !== undefined) out.payee_id      = t.payeeId;
  if (t.payeeName  !== undefined) out.payee_name    = t.payeeName;
  if (t.categoryId !== undefined) out.category_id   = t.categoryId;
  if (t.memo       !== undefined) out.memo           = t.memo;
  if (t.cleared    !== undefined) out.cleared        = t.cleared;
  if (t.approved   !== undefined) out.approved       = t.approved;
  if (t.flagColor  !== undefined) out.flag_color     = t.flagColor;
  return out;
}

const TRANSACTION_UPDATE_VERIFICATION_FIELDS = [
  ["accountId", "account_id"],
  ["date", "date"],
  ["amount", "amount"],
  ["payeeId", "payee_id"],
  ["payeeName", "payee_name"],
  ["categoryId", "category_id"],
  ["memo", "memo"],
  ["cleared", "cleared"],
  ["approved", "approved"],
  ["flagColor", "flag_color"],
];

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function updateFieldMatches(expected, actual) {
  if (typeof expected === "number" && typeof actual === "number") {
    return Math.abs(expected - actual) < 0.0001;
  }
  return Object.is(expected, actual);
}

function transactionUpdateMismatches(requested, actual) {
  const mismatches = [];
  for (const [inputField, outputField] of TRANSACTION_UPDATE_VERIFICATION_FIELDS) {
    if (!hasOwn(requested, inputField)) continue;
    const expected = requested[inputField] ?? null;
    const actualValue = actual[outputField] ?? null;
    if (!updateFieldMatches(expected, actualValue)) {
      mismatches.push({
        field: inputField,
        expected,
        actual: actualValue,
      });
    }
  }
  return mismatches;
}

async function getFormattedTransaction(budgetId, transactionId) {
  const { data } = await api.transactions.getTransactionById(budgetId, normalizeTransactionId(transactionId));
  return formatTransaction(data.transaction);
}

async function verifyBulkTransactionUpdates(budgetId, requestedUpdates) {
  const verification = {
    checked: requestedUpdates.length,
    retried: [],
    failed: [],
  };
  const verified = [];

  for (const requested of requestedUpdates) {
    let refetched = await getFormattedTransaction(budgetId, requested.id);
    let mismatches = transactionUpdateMismatches(requested, refetched);

    if (mismatches.length > 0) {
      verification.retried.push({
        id: requested.id,
        mismatches,
      });
      const { data } = await api.transactions.updateTransaction(budgetId, requested.id, {
        transaction: mapTransactionUpdate(requested),
      });
      refetched = formatTransaction(data.transaction);
      mismatches = transactionUpdateMismatches(requested, refetched);
    }

    if (mismatches.length > 0) {
      verification.failed.push({
        id: requested.id,
        mismatches,
      });
    }

    verified.push(refetched);
  }

  return { verification, verified };
}

// YNAB scheduled transactions that realize get composite IDs like `uuid_YYYY-MM-DD`.
// Strip the date suffix so API lookups work correctly.
function normalizeTransactionId(id) {
  return id.replace(/_\d{4}-\d{2}-\d{2}$/, "");
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function collection(data, key, items, lastKnowledgeOfServer) {
  return lastKnowledgeOfServer === undefined
    ? items
    : { [key]: items, server_knowledge: data.server_knowledge };
}

function pathSegment(value) {
  return encodeURIComponent(String(value));
}

function allHistorySinceDate() {
  return "1970-01-01";
}

function buildTransactionListPath({ budgetId, accountId, categoryId, payeeId, month }) {
  const bid = pathSegment(resolveBudgetId(budgetId));
  if (accountId) return `/plans/${bid}/accounts/${pathSegment(accountId)}/transactions`;
  if (categoryId) return `/plans/${bid}/categories/${pathSegment(categoryId)}/transactions`;
  if (payeeId) return `/plans/${bid}/payees/${pathSegment(payeeId)}/transactions`;
  if (month) return `/plans/${bid}/months/${pathSegment(month)}/transactions`;
  return `/plans/${bid}/transactions`;
}

async function fetchTransactions({
  budgetId,
  sinceDate,
  untilDate,
  type,
  accountId,
  categoryId,
  payeeId,
  month,
  lastKnowledgeOfServer,
}) {
  return ynabFetch(buildTransactionListPath({ budgetId, accountId, categoryId, payeeId, month }), {
    query: {
      since_date: sinceDate,
      until_date: untilDate,
      type,
      last_knowledge_of_server: lastKnowledgeOfServer,
    },
  });
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
    return { content: [{ type: "text", text: `Error: ${sanitizeErrorMessage(msg)}` }], isError: true };
  }
}

function sanitizeErrorMessage(value) {
  let message = String(value ?? "");
  if (API_TOKEN) {
    message = message.split(API_TOKEN).join("[REDACTED_TOKEN]");
  }
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/Authorization:\s*[^\r\n]+/gi, "Authorization: [REDACTED_TOKEN]");
}

function createYnabRateLimiter() {
  const requestsPerHour = Number.parseFloat(process.env.YNAB_RATE_LIMIT_PER_HOUR || "190");
  if (!Number.isFinite(requestsPerHour) || requestsPerHour <= 0) {
    return async () => {};
  }

  const burst = Math.max(1, Number.parseInt(process.env.YNAB_RATE_LIMIT_BURST || "10", 10));
  const refillMs = 3600000 / requestsPerHour;
  let tokens = burst;
  let updatedAt = Date.now();

  return async function waitForYnabRateLimit() {
    while (true) {
      const now = Date.now();
      const elapsed = now - updatedAt;
      tokens = Math.min(burst, tokens + elapsed / refillMs);
      updatedAt = now;

      if (tokens >= 1) {
        tokens -= 1;
        return;
      }

      const waitMs = Math.ceil((1 - tokens) * refillMs);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  };
}

function assertYnabApiUrl(url) {
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== YNAB_API_HOST || (url.port && url.port !== "443")) {
    throw new Error(`Refusing YNAB API request to non-YNAB host: ${url.origin}`);
  }
}

async function secureFetch(input, init = {}) {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  assertYnabApiUrl(url);
  await ynabRateLimit();

  const timeoutMs = Number.parseInt(process.env.YNAB_HTTP_TIMEOUT_MS || "30000", 10);
  const controller = !init.signal && timeoutMs > 0 ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(new Error(`YNAB request timed out after ${timeoutMs}ms`)), timeoutMs)
    : null;

  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: controller?.signal || init.signal,
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildYnabUrl(path) {
  if (!path.startsWith("/") || path.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(path) || /[\r\n]/.test(path)) {
    throw new Error("Refusing unsafe YNAB API path");
  }
  return new URL(`${BASE_URL}${path}`);
}

// Direct API helper for endpoints not yet in the ynab SDK
async function ynabFetch(path, { method = "GET", body, query } = {}) {
  const url = buildYnabUrl(path);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const opts = {
    method,
    headers: { Authorization: `Bearer ${effectiveApiToken}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await secureFetch(url, opts);
  const contentLength = Number.parseInt(res.headers.get("content-length") || "0", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw new Error(`YNAB response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error(`YNAB response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(sanitizeErrorMessage(json?.error?.detail || `HTTP ${res.status}`));
    err.error = json?.error ? { ...json.error, detail: sanitizeErrorMessage(json.error.detail) } : undefined;
    throw err;
  }
  return json.data;
}

// --- Server ---

const server = new McpServer({
  name: "mcp-server-for-ynab",
  version: "3.0.0",
});

const registeredTools = new Map();
const toolCatalog = new Map();

function registerTool(name, config, handler) {
  const registration = server.registerTool(name, config, handler);
  toolCatalog.set(name, { config });
  if (registration !== undefined) {
    registeredTools.set(name, { config, handler });
  }
  return registration;
}

function listRegisteredYnabTools() {
  return [...toolCatalog.entries()]
    .filter(([name]) => !name.startsWith("ynab_"))
    .map(([name, { config }]) => {
      const writeMetadata = WRITE_TOOL_METADATA[name];
      const isWrite = !!writeMetadata;
      let status = "available";
      if (isWrite && !writesEnabled()) {
        status = "hidden_requires_YNAB_ALLOW_WRITES_1";
      } else if (!API_TOKEN) {
        status = "discoverable_requires_credentials";
      }
      return {
        name,
        title: config?.title ?? name,
        description: isWrite ? withWriteGateDescription(config?.description ?? "") : config?.description ?? "",
        has_input_schema: !!config?.inputSchema,
        is_write: isWrite,
        registered: registeredTools.has(name),
        status,
      };
    });
}

const WRITE_TOOL_METADATA = {
  create_account: { destructiveHint: false, idempotentHint: false },
  update_month_category: { destructiveHint: false, idempotentHint: true },
  update_category: { destructiveHint: false, idempotentHint: true },
  create_category: { destructiveHint: false, idempotentHint: false },
  create_category_group: { destructiveHint: false, idempotentHint: false },
  update_category_group: { destructiveHint: false, idempotentHint: true },
  update_payee: { destructiveHint: false, idempotentHint: true },
  create_payee: { destructiveHint: false, idempotentHint: false },
  create_transaction: { destructiveHint: false, idempotentHint: false },
  create_transactions: { destructiveHint: false, idempotentHint: false },
  update_transaction: { destructiveHint: false, idempotentHint: true },
  delete_transaction: { destructiveHint: true, idempotentHint: true },
  update_transactions: { destructiveHint: false, idempotentHint: true },
  approve_transactions: { destructiveHint: false, idempotentHint: true },
  reassign_payee_transactions: { destructiveHint: false, idempotentHint: true },
  ynab_write_tool_execute: { destructiveHint: false, idempotentHint: false },
  import_transactions: { destructiveHint: false, idempotentHint: false },
  create_scheduled_transaction: { destructiveHint: false, idempotentHint: false },
  update_scheduled_transaction: { destructiveHint: false, idempotentHint: true },
  delete_scheduled_transaction: { destructiveHint: true, idempotentHint: true },
};

function writesEnabled() {
  return process.env.YNAB_ALLOW_WRITES === "1";
}

function ynabAuthStatus() {
  const authenticated = !!API_TOKEN;
  const writeToolsAvailable = authenticated && writesEnabled();
  return {
    authenticated,
    default_budget_id_configured: !!DEFAULT_BUDGET_ID,
    writes_enabled: writesEnabled(),
    write_tools_available: writeToolsAvailable,
    message: authenticated
      ? "MCP Server for YNAB has an API token configured."
      : "MCP Server for YNAB is running in discovery-only mode. Set YNAB_API_TOKEN, YNAB_API_TOKEN_FILE, or YNAB_OP_PATH, then restart the MCP server before calling API tools.",
  };
}

function writeDisabledResult(name) {
  return {
    content: [{
      type: "text",
      text: `Error: ${name} is disabled. Restart the MCP server with YNAB_ALLOW_WRITES=1 to enable write tools.`,
    }],
    isError: true,
  };
}

function withWriteGateDescription(description = "") {
  if (description.includes("YNAB_ALLOW_WRITES=1")) return description;
  return `${description} Requires YNAB_ALLOW_WRITES=1; write tools are not registered by default.`;
}

const registerRawTool = server.registerTool.bind(server);
server.registerTool = (name, config, handler) => {
  const writeMetadata = WRITE_TOOL_METADATA[name];
  if (!writeMetadata) {
    return registerRawTool(name, {
      ...config,
      annotations: {
        ...config.annotations,
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      },
    }, handler);
  }

  if (!writesEnabled()) {
    return undefined;
  }

  return registerRawTool(name, {
    ...config,
    description: withWriteGateDescription(config.description),
    annotations: {
      ...config.annotations,
      readOnlyHint: false,
      destructiveHint: writeMetadata.destructiveHint,
      idempotentHint: writeMetadata.idempotentHint,
      openWorldHint: true,
    },
  }, (args, extra) => {
    if (!writesEnabled()) {
      return writeDisabledResult(name);
    }
    return handler(args, extra);
  });
};

// ==================== User & Budgets ====================

registerTool(
  "get_user",
  { description: "Get the authenticated user" },
  () =>
  run(async () => {
    const { data } = await api.user.getUser();
    return ok(data.user);
  })
);

registerTool(
  "list_budgets",
  { description: "List all budgets. Use a budget ID from the results in other tools, or omit budgetId to use the last-used budget." },
  () =>
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

registerTool(
  "get_budget",
  { description: "Get a budget summary including name, currency format, and account/category/payee counts", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
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

registerTool(
  "get_budget_settings",
  { description: "Get budget settings (currency format, date format)", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
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
  return withCurrencyFields(out, a, ["balance", "cleared_balance", "uncleared_balance"]);
}

registerTool(
  "list_accounts",
  { description: "List all accounts in a budget", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns { accounts, server_knowledge }."),
  } },
  ({ budgetId, lastKnowledgeOfServer }) =>
    run(async () => {
      const { data } = await api.accounts.getAccounts(resolveBudgetId(budgetId), lastKnowledgeOfServer);
      const accounts = data.accounts.map(formatAccount);
      return ok(collection(data, "accounts", accounts, lastKnowledgeOfServer));
    })
);

registerTool(
  "get_account",
  { description: "Get details for a specific account", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    accountId: z.string().describe("Account ID"),
  } },
  ({ budgetId, accountId }) =>
    run(async () => {
      const { data } = await api.accounts.getAccountById(resolveBudgetId(budgetId), accountId);
      return ok(formatAccount(data.account));
    })
);

registerTool(
  "create_account",
  { description: "Create a new account", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    name: z.string().describe("Account name"),
    type: z.enum(["checking", "savings", "cash", "creditCard", "lineOfCredit", "otherAsset", "otherLiability", "mortgage", "autoLoan", "studentLoan", "personalLoan", "medicalDebt", "otherDebt"]).describe("Account type"),
    balance: z.number().describe("Starting balance in dollars"),
  } },
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
  const out = {
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
    goal_target_month: c.goal_target_month,
    goal_target_date: c.goal_target_date,
    goal_percentage_complete: c.goal_percentage_complete,
    goal_months_to_budget: c.goal_months_to_budget,
    goal_under_funded: dollars(c.goal_under_funded),
    goal_overall_funded: dollars(c.goal_overall_funded),
    goal_overall_left: dollars(c.goal_overall_left),
    goal_needs_whole_amount: c.goal_needs_whole_amount,
    goal_snoozed_at: c.goal_snoozed_at,
    deleted: c.deleted,
  };
  return withCurrencyFields(out, c, [
    "budgeted",
    "activity",
    "balance",
    "goal_target",
    "goal_under_funded",
    "goal_overall_funded",
    "goal_overall_left",
  ]);
}

registerTool(
  "list_categories",
  { description: "List all category groups and their categories", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns { category_groups, server_knowledge }."),
  } },
  ({ budgetId, lastKnowledgeOfServer }) =>
    run(async () => {
      const { data } = await api.categories.getCategories(resolveBudgetId(budgetId), lastKnowledgeOfServer);
      const categoryGroups = data.category_groups.map((g) => ({
          id: g.id,
          name: g.name,
          hidden: g.hidden,
          deleted: g.deleted,
          categories: g.categories.map((c) =>
            withCurrencyFields(
              {
                id: c.id,
                name: c.name,
                hidden: c.hidden,
                budgeted: dollars(c.budgeted),
                activity: dollars(c.activity),
                balance: dollars(c.balance),
                goal_type: c.goal_type,
                goal_needs_whole_amount: c.goal_needs_whole_amount,
                deleted: c.deleted,
              },
              c,
              ["budgeted", "activity", "balance"]
            )
          ),
        }));
      return ok(collection(data, "category_groups", categoryGroups, lastKnowledgeOfServer));
    })
);

registerTool(
  "get_category",
  { description: "Get a specific category", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryId: z.string().describe("Category ID"),
  } },
  ({ budgetId, categoryId }) =>
    run(async () => {
      const { data } = await api.categories.getCategoryById(resolveBudgetId(budgetId), categoryId);
      return ok(formatCategory(data.category));
    })
);

registerTool(
  "get_month_category",
  { description: "Get category budget for a specific month", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
    categoryId: z.string().describe("Category ID"),
  } },
  ({ budgetId, month, categoryId }) =>
    run(async () => {
      const { data } = await api.categories.getMonthCategoryById(resolveBudgetId(budgetId), month, categoryId);
      return ok(formatCategory(data.category));
    })
);

registerTool(
  "update_month_category",
  { description: "Set the budgeted amount for a category in a specific month", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
    categoryId: z.string().describe("Category ID"),
    budgeted: z.number().describe("Amount to budget in dollars"),
  } },
  ({ budgetId, month, categoryId, budgeted }) =>
    run(async () => {
      const { data } = await api.categories.updateMonthCategory(resolveBudgetId(budgetId), month, categoryId, {
        category: { budgeted: milliunits(budgeted) },
      });
      return ok(formatCategory(data.category));
    })
);

registerTool(
  "update_category",
  { description: "Update a category's name, note, goal target, or move it to a different group", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryId: z.string().describe("Category ID"),
    name: z.string().optional().describe("New category name"),
    note: z.string().nullable().optional().describe("Category note (null to clear)"),
    categoryGroupId: z.string().optional().describe("Move to a different category group"),
    goalTarget: z.number().nullable().optional().describe("Goal target amount in dollars (only if category already has a goal)"),
    goalTargetDate: z.string().nullable().optional().describe("Goal target date in ISO format (e.g. 2026-12-01, null to clear)"),
    goalNeedsWholeAmount: z.boolean().nullable().optional().describe("For NEED goals, true uses 'Set aside another' behavior and false uses 'Refill up to' behavior"),
  } },
  ({ budgetId, categoryId, name, note, categoryGroupId, goalTarget, goalTargetDate, goalNeedsWholeAmount }) =>
    run(async () => {
      const cat = {};
      if (name !== undefined) cat.name = name;
      if (note !== undefined) cat.note = note;
      if (categoryGroupId !== undefined) cat.category_group_id = categoryGroupId;
      if (goalTarget !== undefined) cat.goal_target = goalTarget != null ? milliunits(goalTarget) : null;
      if (goalTargetDate !== undefined) cat.goal_target_date = goalTargetDate;
      if (goalNeedsWholeAmount !== undefined) cat.goal_needs_whole_amount = goalNeedsWholeAmount;

      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/categories/${categoryId}`, {
        method: "PATCH",
        body: { category: cat },
      });
      return ok(formatCategory(data.category));
    })
);

registerTool(
  "create_category",
  { description: "Create a new category in a category group", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryGroupId: z.string().describe("Category group ID to create the category in"),
    name: z.string().describe("Category name"),
    note: z.string().optional().describe("Category note"),
    goalTarget: z.number().optional().describe("Goal target amount in dollars (creates a 'Needed for Spending' goal)"),
    goalTargetDate: z.string().optional().describe("Goal target date in ISO format (e.g. 2026-12-01)"),
    goalNeedsWholeAmount: z.boolean().optional().describe("For NEED goals, true uses 'Set aside another' behavior and false uses 'Refill up to' behavior"),
  } },
  ({ budgetId, categoryGroupId, name, note, goalTarget, goalTargetDate, goalNeedsWholeAmount }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const cat = { category_group_id: categoryGroupId, name };
      if (note !== undefined) cat.note = note;
      if (goalTarget !== undefined) cat.goal_target = milliunits(goalTarget);
      if (goalTargetDate !== undefined) cat.goal_target_date = goalTargetDate;
      if (goalNeedsWholeAmount !== undefined) cat.goal_needs_whole_amount = goalNeedsWholeAmount;
      const data = await ynabFetch(`/plans/${bid}/categories`, {
        method: "POST",
        body: { category: cat },
      });
      return ok(formatCategory(data.category));
    })
);

registerTool(
  "create_category_group",
  { description: "Create a new category group", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    name: z.string().describe("Category group name (max 50 characters)"),
  } },
  ({ budgetId, name }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/category_groups`, {
        method: "POST",
        body: { category_group: { name } },
      });
      return ok(data.category_group);
    })
);

registerTool(
  "update_category_group",
  { description: "Rename a category group", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryGroupId: z.string().describe("Category group ID"),
    name: z.string().describe("New category group name (max 50 characters)"),
  } },
  ({ budgetId, categoryGroupId, name }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/category_groups/${categoryGroupId}`, {
        method: "PATCH",
        body: { category_group: { name } },
      });
      return ok(data.category_group);
    })
);

// ==================== Payees ====================

registerTool(
  "list_payees",
  { description: "List all payees", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns { payees, server_knowledge }."),
  } },
  ({ budgetId, lastKnowledgeOfServer }) =>
    run(async () => {
      const { data } = await api.payees.getPayees(resolveBudgetId(budgetId), lastKnowledgeOfServer);
      const payees = data.payees.map((p) => ({ id: p.id, name: p.name, transfer_account_id: p.transfer_account_id, deleted: p.deleted }));
      return ok(collection(data, "payees", payees, lastKnowledgeOfServer));
    })
);

registerTool(
  "get_payee",
  { description: "Get a specific payee", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeId: z.string().describe("Payee ID"),
  } },
  ({ budgetId, payeeId }) =>
    run(async () => {
      const { data } = await api.payees.getPayeeById(resolveBudgetId(budgetId), payeeId);
      return ok(data.payee);
    })
);

registerTool(
  "update_payee",
  { description: "Rename a payee", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeId: z.string().describe("Payee ID"),
    name: z.string().describe("New payee name"),
  } },
  ({ budgetId, payeeId, name }) =>
    run(async () => {
      const { data } = await api.payees.updatePayee(resolveBudgetId(budgetId), payeeId, {
        payee: { name },
      });
      return ok(data.payee);
    })
);

registerTool(
  "create_payee",
  { description: "Create a new payee", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    name: z.string().max(500).describe("Payee name (max 500 characters)"),
  } },
  ({ budgetId, name }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/payees`, {
        method: "POST",
        body: { payee: { name } },
      });
      return ok(data.payee);
    })
);

// ==================== Payee Locations ====================

registerTool(
  "list_payee_locations",
  { description: "List all payee locations (GPS coordinates where transactions occurred)", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.payeeLocations.getPayeeLocations(resolveBudgetId(budgetId));
      return ok(data.payee_locations);
    })
);

registerTool(
  "get_payee_location",
  { description: "Get a specific payee location", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeLocationId: z.string().describe("Payee location ID"),
  } },
  ({ budgetId, payeeLocationId }) =>
    run(async () => {
      const { data } = await api.payeeLocations.getPayeeLocationById(resolveBudgetId(budgetId), payeeLocationId);
      return ok(data.payee_location);
    })
);

registerTool(
  "get_payee_locations_by_payee",
  { description: "Get all locations for a specific payee", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeId: z.string().describe("Payee ID"),
  } },
  ({ budgetId, payeeId }) =>
    run(async () => {
      const { data } = await api.payeeLocations.getPayeeLocationsByPayee(resolveBudgetId(budgetId), payeeId);
      return ok(data.payee_locations);
    })
);

// ==================== Months ====================

registerTool(
  "list_months",
  { description: "List all budget months", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns { months, server_knowledge }."),
  } },
  ({ budgetId, lastKnowledgeOfServer }) =>
    run(async () => {
      const { data } = await api.months.getBudgetMonths(resolveBudgetId(budgetId), lastKnowledgeOfServer);
      const months = data.months.map((m) =>
          withCurrencyFields(
            {
              month: m.month,
              note: m.note,
              income: dollars(m.income),
              budgeted: dollars(m.budgeted),
              activity: dollars(m.activity),
              to_be_budgeted: dollars(m.to_be_budgeted),
              age_of_money: m.age_of_money,
              deleted: m.deleted,
            },
            m,
            ["income", "budgeted", "activity", "to_be_budgeted"]
          )
        );
      return ok(collection(data, "months", months, lastKnowledgeOfServer));
    })
);

registerTool(
  "get_month",
  { description: "Get budget month detail with per-category breakdown", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
  } },
  ({ budgetId, month }) =>
    run(async () => {
      const { data } = await api.months.getBudgetMonth(resolveBudgetId(budgetId), month);
      const m = data.month;
      const out = {
        month: m.month,
        note: m.note,
        income: dollars(m.income),
        budgeted: dollars(m.budgeted),
        activity: dollars(m.activity),
        to_be_budgeted: dollars(m.to_be_budgeted),
        age_of_money: m.age_of_money,
        deleted: m.deleted,
        categories: m.categories?.map((c) =>
          withCurrencyFields(
            {
              id: c.id,
              name: c.name,
              hidden: c.hidden,
              category_group_name: c.category_group_name,
              budgeted: dollars(c.budgeted),
              activity: dollars(c.activity),
              balance: dollars(c.balance),
              goal_type: c.goal_type,
              goal_needs_whole_amount: c.goal_needs_whole_amount,
              goal_target: dollars(c.goal_target),
              goal_target_month: c.goal_target_month,
              goal_target_date: c.goal_target_date,
              goal_under_funded: dollars(c.goal_under_funded),
              goal_snoozed_at: c.goal_snoozed_at,
              deleted: c.deleted,
            },
            c,
            ["budgeted", "activity", "balance", "goal_target", "goal_under_funded"]
          )
        ),
      };
      return ok(withCurrencyFields(out, m, ["income", "budgeted", "activity", "to_be_budgeted"]));
    })
);

// ==================== Money Movements ====================

function formatMoneyMovement(m) {
  return withCurrencyFields({
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
  }, m, ["amount"]);
}

registerTool(
  "list_money_movements",
  { description: "List all money movements (budget re-allocations between categories)", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/money_movements`);
      return ok(data.money_movements.map(formatMoneyMovement));
    })
);

registerTool(
  "get_money_movements_by_month",
  { description: "Get money movements for a specific month", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month), or 'current'"),
  } },
  ({ budgetId, month }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/months/${month}/money_movements`);
      return ok(data.money_movements.map(formatMoneyMovement));
    })
);

registerTool(
  "list_money_movement_groups",
  { description: "List all money movement groups (batches of related money movements)", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/money_movement_groups`);
      return ok(data.money_movement_groups);
    })
);

registerTool(
  "get_money_movement_groups_by_month",
  { description: "Get money movement groups for a specific month", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month), or 'current'"),
  } },
  ({ budgetId, month }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/months/${month}/money_movement_groups`);
      return ok(data.money_movement_groups);
    })
);

// ==================== Transactions ====================

function formatTransaction(t) {
  const out = {
    id: t.id,
    date: t.date,
    amount: dollars(t.amount),
    memo: t.memo ?? null,
    cleared: t.cleared,
    approved: t.approved,
    flag_color: t.flag_color ?? null,
    flag_name: t.flag_name ?? null,
    account_id: t.account_id,
    account_name: t.account_name,
    payee_id: t.payee_id ?? null,
    payee_name: t.payee_name ?? null,
    category_id: t.category_id ?? null,
    category_name: t.category_name ?? null,
    transfer_account_id: t.transfer_account_id ?? null,
    transfer_transaction_id: t.transfer_transaction_id ?? null,
    matched_transaction_id: t.matched_transaction_id ?? null,
    import_id: t.import_id ?? null,
    import_payee_name: t.import_payee_name ?? null,
    import_payee_name_original: t.import_payee_name_original ?? null,
    debt_transaction_type: t.debt_transaction_type ?? null,
    deleted: t.deleted,
    subtransactions: t.subtransactions?.map((s) =>
      withCurrencyFields(
        {
          id: s.id,
          transaction_id: s.transaction_id,
          amount: dollars(s.amount),
          memo: s.memo ?? null,
          payee_id: s.payee_id ?? null,
          payee_name: s.payee_name ?? null,
          category_id: s.category_id ?? null,
          category_name: s.category_name ?? null,
          transfer_account_id: s.transfer_account_id ?? null,
          transfer_transaction_id: s.transfer_transaction_id ?? null,
          deleted: s.deleted,
        },
        s,
        ["amount"]
      )
    ),
  };
  return withCurrencyFields(out, t, ["amount"]);
}

registerTool(
  "get_transactions",
  { description: "Get transactions with optional filters. Use type='unapproved' or type='uncategorized' to filter. Optionally filter by account, category, payee, or month. Each returned transaction includes 'import_payee_name_original' — the raw merchant string from the bank import (e.g. 'AplPay LS ONION RIVEMONTPELIER VT') — which encodes processor flag, merchant name (often longer than the cleaned payee_name), and city+state. This is the primary disambiguation field when payee_name is truncated or ambiguous. YNAB now defaults omitted sinceDate to one year ago; pass an explicit older sinceDate to retrieve older history. Note: large date ranges (6+ months on a busy budget) can return 50KB+ of data; narrow with categoryId/payeeId/month/sinceDate/untilDate filters when possible.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    sinceDate: z.string().optional().describe("Only return transactions on or after this date (YYYY-MM-DD). If omitted, YNAB defaults to one year ago."),
    untilDate: z.string().optional().describe("Only return transactions on or before this date (YYYY-MM-DD)"),
    type: z.enum(["unapproved", "uncategorized"]).optional().describe("Filter by approval/categorization status"),
    accountId: z.string().optional().describe("Filter by account ID"),
    categoryId: z.string().optional().describe("Filter by category ID"),
    payeeId: z.string().optional().describe("Filter by payee ID"),
    month: z.string().optional().describe("Filter by month (YYYY-MM-DD, first of month)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns { transactions, server_knowledge }."),
  } },
  ({ budgetId, sinceDate, untilDate, type, accountId, categoryId, payeeId, month, lastKnowledgeOfServer }) =>
    run(async () => {
      const resourceFilters = [accountId, categoryId, payeeId, month].filter((value) => value !== undefined && value !== null && value !== "");
      if (resourceFilters.length > 1) {
        throw new Error("Provide only one of accountId, categoryId, payeeId, or month.");
      }

      const data = await fetchTransactions({
        budgetId,
        sinceDate,
        untilDate,
        type,
        accountId,
        categoryId,
        payeeId,
        month,
        lastKnowledgeOfServer,
      });
      const transactions = data.transactions;
      return ok(collection(data, "transactions", transactions.map(formatTransaction), lastKnowledgeOfServer));
    })
);

registerTool(
  "get_transaction",
  { description: "Get a single transaction by ID. Automatically handles composite scheduled-transaction IDs (e.g. uuid_YYYY-MM-DD): the date suffix is stripped before the lookup. If a composite ID's underlying matched transaction has been deleted, falls back to returning the active scheduled-transaction template wrapped in a marker shape { resource_type: 'scheduled_transaction', reason: 'composite_id_with_no_matched_transaction', scheduled_transaction, requested_id } so callers can distinguish the two return shapes. Non-composite IDs preserve strict behavior: a 404 still surfaces as resource_not_found.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("Transaction ID"),
  } },
  ({ budgetId, transactionId }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const normalizedId = normalizeTransactionId(transactionId);
      const isComposite = /_\d{4}-\d{2}-\d{2}$/.test(transactionId);
      try {
        const { data } = await api.transactions.getTransactionById(bid, normalizedId);
        return ok(formatTransaction(data.transaction));
      } catch (e) {
        // Only fall back for composite IDs on resource_not_found. Other errors
        // (auth, rate limit, network) and non-composite not-founds bubble up unchanged.
        if (!isComposite || e?.error?.name !== "resource_not_found") throw e;
        try {
          const { data } = await api.scheduledTransactions.getScheduledTransactionById(bid, normalizedId);
          return ok({
            resource_type: "scheduled_transaction",
            reason: "composite_id_with_no_matched_transaction",
            scheduled_transaction: formatScheduledTransaction(data.scheduled_transaction),
            requested_id: transactionId,
          });
        } catch (e2) {
          if (e2?.error?.name !== "resource_not_found") throw e2;
          throw {
            error: {
              id: "404",
              name: "resource_not_found",
              detail: `Resource not found (tried transaction ${normalizedId} and scheduled transaction ${normalizedId}; both returned not-found)`,
            },
          };
        }
      }
    })
);

registerTool(
  "create_transaction",
  { description: "Create a new transaction. Amounts are in dollars (positive for inflows, negative for outflows). Note: future-dated transactions cannot be created here - use create_scheduled_transaction instead.", inputSchema: {
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
  } },
  ({ budgetId, ...txnFields }) =>
    run(async () => {
      const { data } = await api.transactions.createTransaction(resolveBudgetId(budgetId), {
        transaction: mapTransactionInput(txnFields),
      });
      return ok(formatTransaction(data.transaction));
    })
);

registerTool(
  "create_transactions",
  { description: "Create multiple transactions at once. Amounts are in dollars. Returns created transactions and any duplicate import IDs. Future-dated transactions are not supported - use create_scheduled_transaction instead.", inputSchema: {
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
  } },
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

registerTool(
  "update_transaction",
  { description: "Update an existing transaction. Only provided fields are changed. Amounts in dollars.", inputSchema: {
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
  } },
  ({ budgetId, transactionId, accountId, date, amount, payeeId, payeeName, categoryId, memo, cleared, approved, flagColor }) =>
    run(async () => {
      const { data } = await api.transactions.updateTransaction(resolveBudgetId(budgetId), transactionId, {
        transaction: mapTransactionUpdate({ accountId, date, amount, payeeId, payeeName, categoryId, memo, cleared, approved, flagColor }),
      });
      return ok(formatTransaction(data.transaction));
    })
);

registerTool(
  "delete_transaction",
  { description: "Delete a transaction", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("Transaction ID"),
  } },
  ({ budgetId, transactionId }) =>
    run(async () => {
      const { data } = await api.transactions.deleteTransaction(resolveBudgetId(budgetId), transactionId);
      return ok(formatTransaction(data.transaction));
    })
);

registerTool(
  "update_transactions",
  { description: "Batch update multiple transactions. Each transaction object must include its id and the fields to update. IMPORTANT: only use transaction IDs extracted from get_transactions / review_unapproved results — never compose IDs by hand (fabricated IDs return 'transaction does not exist in this budget' errors). For combined category+approval changes, include both 'categoryId' and 'approved: true' in the same entry. This tool refetches each transaction after the bulk update, verifies requested fields actually persisted, and retries mismatches once through single-transaction updates. Never trust review_unapproved counts alone after approving transactions; use this response's verification block or get_transaction to confirm fields.", inputSchema: {
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
    returnSummary: z.boolean().optional().describe("If true, return compact counts (updated_count, approved_count, and verification counts) instead of the full updated-transaction objects. Use for large batches (~50+) whose full response would exceed the inline tool-result limit; the write is performed identically either way."),
  } },
  ({ budgetId, transactions: txns, returnSummary }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const mapped = txns.map((t) => ({ id: t.id, ...mapTransactionUpdate(t) }));
      const { data } = await api.transactions.updateTransactions(bid, {
        transactions: mapped,
      });
      const { verification, verified } = await verifyBulkTransactionUpdates(bid, txns);
      if (verification.failed.length > 0) {
        return {
          content: [{
            type: "text",
            text: `Error: Bulk transaction update verification failed after retry: ${JSON.stringify(verification.failed, null, 2)}`,
          }],
          isError: true,
        };
      }
      if (returnSummary) {
        return ok({
          updated_count: verified.length,
          approved_count: verified.filter((t) => t.approved).length,
          duplicate_import_ids: data.duplicate_import_ids,
          verification: {
            checked: verification.checked,
            retried: verification.retried.length,
            failed: verification.failed.length,
          },
        });
      }
      return ok({
        updated: verified,
        duplicate_import_ids: data.duplicate_import_ids,
        verification,
      });
    })
);

registerTool(
  "approve_transactions",
  { description: "Approve unapproved transactions in bulk by filter, without hand-listing IDs. Fetches the current unapproved queue, optionally narrows by payeeId / categoryId / accountId, and sets approved:true on the matches. By default SKIPS uncategorized transactions (no category and not a transfer) so nothing is approved without a category; set includeUncategorized:true to override. Returns a compact summary (approved_count + verification counts), never full objects, so it is safe on large batches. Requires confirmed:true after explicit user confirmation.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms this approval action."),
    expectedMatchedCount: z.number().int().nonnegative().optional().describe("Optional safety check. If provided and the current match count differs, no transactions are approved."),
    sinceDate: z.string().optional().describe("Only inspect unapproved transactions on or after this date (YYYY-MM-DD). Defaults to all history."),
    untilDate: z.string().optional().describe("Only inspect unapproved transactions on or before this date (YYYY-MM-DD)."),
    payeeId: z.string().optional().describe("Only approve unapproved transactions for this payee"),
    categoryId: z.string().optional().describe("Only approve unapproved transactions in this category"),
    accountId: z.string().optional().describe("Only approve unapproved transactions in this account"),
    includeUncategorized: z.boolean().optional().describe("If true, also approve transactions with no category (default false — uncategorized are skipped for safety)"),
  } },
  ({ budgetId, expectedMatchedCount, sinceDate, untilDate, payeeId, categoryId, accountId, includeUncategorized }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const data = await fetchTransactions({
        budgetId: bid,
        sinceDate: sinceDate || allHistorySinceDate(),
        untilDate,
        type: "unapproved",
      });
      let txns = data.transactions.filter((t) => !t.deleted);
      if (payeeId) txns = txns.filter((t) => t.payee_id === payeeId);
      if (categoryId) txns = txns.filter((t) => t.category_id === categoryId);
      if (accountId) txns = txns.filter((t) => t.account_id === accountId);
      if (!includeUncategorized) {
        txns = txns.filter((t) => (t.category_id && t.category_name !== "Uncategorized") || t.transfer_account_id);
      }
      if (expectedMatchedCount !== undefined && expectedMatchedCount !== txns.length) {
        throw new Error(`approve_transactions matched ${txns.length} transactions, but expectedMatchedCount was ${expectedMatchedCount}; no transactions were approved.`);
      }
      if (txns.length === 0) {
        return ok({ approved_count: 0, matched: 0, message: "No matching unapproved transactions to approve." });
      }
      const updates = txns.map((t) => ({ id: t.id, approved: true }));
      const mapped = updates.map((t) => ({ id: t.id, ...mapTransactionUpdate(t) }));
      const { data: updData } = await api.transactions.updateTransactions(bid, { transactions: mapped });
      const { verification, verified } = await verifyBulkTransactionUpdates(bid, updates);
      if (verification.failed.length > 0) {
        return {
          content: [{ type: "text", text: `Error: approval verification failed after retry: ${JSON.stringify(verification.failed, null, 2)}` }],
          isError: true,
        };
      }
      return ok({
        matched: txns.length,
        approved_count: verified.filter((t) => t.approved).length,
        filters: { payeeId: payeeId || null, categoryId: categoryId || null, accountId: accountId || null, includeUncategorized: !!includeUncategorized },
        duplicate_import_ids: updData.duplicate_import_ids,
        verification: { checked: verification.checked, retried: verification.retried.length, failed: verification.failed.length },
      });
    })
);

registerTool(
  "reassign_payee_transactions",
  { description: "Move all transactions from one payee to another. The YNAB API has no payee-merge or payee-delete endpoint, so this is the merge workaround: refetch every transaction for fromPayeeId and set payee_id = toPayeeId. Use to consolidate a duplicate payee that a slightly different bank-import string created (e.g. fold 'Myles Court Barber' into the existing 'Myles Court Barbershop'). The emptied source payee still exists afterward and must be deleted manually in the YNAB UI (Settings → Manage Payees) if wanted. Returns a compact summary. Requires confirmed:true after explicit user confirmation.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms this payee reassignment."),
    expectedMatchedCount: z.number().int().nonnegative().optional().describe("Optional safety check. If provided and the current match count differs, no transactions are reassigned."),
    fromPayeeId: z.string().describe("Payee whose transactions will be moved"),
    toPayeeId: z.string().describe("Destination payee that transactions will be reassigned to"),
    sinceDate: z.string().optional().describe("Only move transactions on or after this date (YYYY-MM-DD); defaults to all history"),
    untilDate: z.string().optional().describe("Only move transactions on or before this date (YYYY-MM-DD)"),
  } },
  ({ budgetId, expectedMatchedCount, fromPayeeId, toPayeeId, sinceDate, untilDate }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const data = await fetchTransactions({
        budgetId: bid,
        payeeId: fromPayeeId,
        sinceDate: sinceDate || allHistorySinceDate(),
        untilDate,
      });
      const txns = data.transactions.filter((t) => !t.deleted);
      if (expectedMatchedCount !== undefined && expectedMatchedCount !== txns.length) {
        throw new Error(`reassign_payee_transactions matched ${txns.length} transactions, but expectedMatchedCount was ${expectedMatchedCount}; no transactions were reassigned.`);
      }
      if (txns.length === 0) {
        return ok({ reassigned_count: 0, message: "No transactions found for fromPayeeId in the given range." });
      }
      const updates = txns.map((t) => ({ id: t.id, payeeId: toPayeeId }));
      const mapped = updates.map((t) => ({ id: t.id, ...mapTransactionUpdate(t) }));
      const { data: updData } = await api.transactions.updateTransactions(bid, { transactions: mapped });
      const { verification, verified } = await verifyBulkTransactionUpdates(bid, updates);
      if (verification.failed.length > 0) {
        return {
          content: [{ type: "text", text: `Error: payee reassignment verification failed after retry: ${JSON.stringify(verification.failed, null, 2)}` }],
          isError: true,
        };
      }
      return ok({
        reassigned_count: verified.length,
        from_payee_id: fromPayeeId,
        to_payee_id: toPayeeId,
        duplicate_import_ids: updData.duplicate_import_ids,
        note: "Source payee is now empty but still exists; delete it in the YNAB UI (Settings → Manage Payees) if desired.",
        verification: { checked: verification.checked, retried: verification.retried.length, failed: verification.failed.length },
      });
    })
);

registerTool(
  "import_transactions",
  { description: "Trigger import of linked account transactions", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.transactions.importTransactions(resolveBudgetId(budgetId));
      return ok(data);
    })
);

// ==================== Scheduled Transactions ====================

function formatScheduledTransaction(t) {
  const out = {
    id: t.id,
    date_first: t.date_first,
    date_next: t.date_next,
    frequency: t.frequency,
    amount: dollars(t.amount),
    memo: t.memo ?? null,
    flag_color: t.flag_color ?? null,
    flag_name: t.flag_name ?? null,
    account_id: t.account_id,
    account_name: t.account_name,
    payee_id: t.payee_id ?? null,
    payee_name: t.payee_name ?? null,
    category_id: t.category_id ?? null,
    category_name: t.category_name ?? null,
    transfer_account_id: t.transfer_account_id ?? null,
    deleted: t.deleted,
    subtransactions: t.subtransactions?.map((s) =>
      withCurrencyFields(
        {
          id: s.id,
          scheduled_transaction_id: s.scheduled_transaction_id,
          amount: dollars(s.amount),
          memo: s.memo ?? null,
          payee_id: s.payee_id ?? null,
          payee_name: s.payee_name ?? null,
          category_id: s.category_id ?? null,
          category_name: s.category_name ?? null,
          transfer_account_id: s.transfer_account_id ?? null,
          deleted: s.deleted,
        },
        s,
        ["amount"]
      )
    ),
  };
  return withCurrencyFields(out, t, ["amount"]);
}

registerTool(
  "list_scheduled_transactions",
  { description: "List all scheduled (recurring) transactions. NOTE: only manually-created recurring entries appear here — auto-imported recurring charges (subscriptions, utilities, insurance) are NOT included. Use prior-month transaction history to identify recurring charge timing instead.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns { scheduled_transactions, server_knowledge }."),
  } },
  ({ budgetId, lastKnowledgeOfServer }) =>
    run(async () => {
      const { data } = await api.scheduledTransactions.getScheduledTransactions(resolveBudgetId(budgetId), lastKnowledgeOfServer);
      const scheduledTransactions = data.scheduled_transactions.map(formatScheduledTransaction);
      return ok(collection(data, "scheduled_transactions", scheduledTransactions, lastKnowledgeOfServer));
    })
);

registerTool(
  "get_scheduled_transaction",
  { description: "Get a specific scheduled transaction", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    scheduledTransactionId: z.string().describe("Scheduled transaction ID"),
  } },
  ({ budgetId, scheduledTransactionId }) =>
    run(async () => {
      const { data } = await api.scheduledTransactions.getScheduledTransactionById(resolveBudgetId(budgetId), scheduledTransactionId);
      return ok(formatScheduledTransaction(data.scheduled_transaction));
    })
);

registerTool(
  "create_scheduled_transaction",
  { description: "Create a new scheduled (recurring) transaction", inputSchema: {
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
  } },
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

registerTool(
  "update_scheduled_transaction",
  { description: "Update an existing scheduled transaction. Only provided fields are changed. Amounts in dollars.", inputSchema: {
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
  } },
  ({ budgetId, scheduledTransactionId, accountId, date, frequency, amount, payeeId, payeeName, categoryId, memo, flagColor }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      // PUT replaces the full resource - fetch current values to merge with updates
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

registerTool(
  "delete_scheduled_transaction",
  { description: "Delete a scheduled transaction", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    scheduledTransactionId: z.string().describe("Scheduled transaction ID"),
  } },
  ({ budgetId, scheduledTransactionId }) =>
    run(async () => {
      const { data } = await api.scheduledTransactions.deleteScheduledTransaction(resolveBudgetId(budgetId), scheduledTransactionId);
      return ok(formatScheduledTransaction(data.scheduled_transaction));
    })
);

// ==================== Convenience Tools ====================

registerTool(
  "search_categories",
  { description: "Search categories by partial name match (case-insensitive). Useful for finding category IDs when you only know part of the name.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    query: z.string().describe("Partial category name to search for (e.g. 'work' matches '💻 Work Expenses (Oliver LLC)')"),
  } },
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
            matches.push(withCurrencyFields({
              id: c.id,
              name: c.name,
              group: g.name,
              budgeted: dollars(c.budgeted),
              activity: dollars(c.activity),
              balance: dollars(c.balance),
            }, c, ["budgeted", "activity", "balance"]));
          }
        }
      }
      if (matches.length === 0) return ok({ message: `No categories matching "${query}"`, suggestions: "Try a shorter search term" });
      return ok(matches);
    })
);

registerTool(
  "search_payees",
  { description: "Search payees by partial name match (case-insensitive). Useful for finding payee IDs.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    query: z.string().describe("Partial payee name to search for"),
  } },
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

registerTool(
  "review_unapproved",
  { description: "Get all unapproved transactions grouped by status: those already categorized (ready to approve) and those still uncategorized (need category first). Each transaction includes a 'flags' array: manually_entered (not bank-imported), match_broken (matched reference is stale — the `matched_transaction_id` field is read-only via this API; YNAB web/iOS UI is required to clear that link. The transaction itself remains fully mutable: you CAN approve, recategorize, and edit memo via update_transaction. The broken match persists as a cosmetic flag until the user resolves it in the UI.), scheduled_transaction_realized, new_payee (no transaction history for this payee), no_prior_amount_match (novel amount for this payee), category_drift:was_X (payee categorized differently before). Never approve uncategorized transactions without explicit user instruction. For large budgets the full response can exceed 100KB; pass summary:true for counts + by-payee aggregates only, or compact:true to keep per-transaction rows (with IDs) while dropping bulky fields so the response fits inline.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    summary: z.boolean().optional().describe("If true, omit per-transaction details from the response and return only counts + by-payee aggregates (for both ready_to_approve and needs_category_first). Use this when the full unapproved queue is large; drill into specifics with get_transactions afterwards."),
    compact: z.boolean().optional().describe("If true (and summary is not set), keep per-transaction detail but return only the fields needed to act — id, date, payee_name, amount, category_name, account_name, flags — dropping bulky fields (import strings, subtransactions, matched/import ids) that push the full response past the inline size limit. Use when you need transaction IDs to approve or recategorize but the full queue would overflow."),
  } },
  ({ budgetId, summary, compact }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);

      // Fetch unapproved transactions
      const { data: unapprovedData } = await api.transactions.getTransactions(bid, undefined, "unapproved");
      const txns = unapprovedData.transactions.map(formatTransaction);
      const unapprovedIds = new Set(txns.map((t) => t.id));

      // Fetch 60 days of approved history for context
      const since60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: histData } = await api.transactions.getTransactions(bid, since60);
      const histTxns = histData.transactions.filter((t) => t.approved && !unapprovedIds.has(t.id));

      // Build payee history lookups (using raw milliunits for history, convert to dollars for the set)
      const payeeAmounts = {}; // payeeId -> Set of dollar amounts seen
      const payeeCategories = {}; // payeeId -> Map of categoryId -> categoryName
      for (const h of histTxns) {
        if (!h.payee_id) continue;
        const pid = h.payee_id;
        const amt = dollars(h.amount);
        const cid = h.category_id;
        const cname = h.category_name;
        if (!payeeAmounts[pid]) payeeAmounts[pid] = new Set();
        payeeAmounts[pid].add(amt);
        if (cid) {
          if (!payeeCategories[pid]) payeeCategories[pid] = new Map();
          payeeCategories[pid].set(cid, cname);
        }
      }

      // Attach flags to each unapproved transaction
      function flagTransaction(t) {
        const flags = [];
        const isTransfer = !!t.transfer_account_id;
        if (!t.import_id && !isTransfer) flags.push("manually_entered");
        if (t.matched_transaction_id && !t.import_id) flags.push("match_broken");
        if (/_\d{4}-\d{2}-\d{2}$/.test(t.id)) flags.push("scheduled_transaction_realized");
        if (t.payee_id) {
          const hasHistory = !!payeeAmounts[t.payee_id];
          if (!hasHistory) {
            flags.push("new_payee");
          } else {
            if (!payeeAmounts[t.payee_id].has(t.amount)) flags.push("no_prior_amount_match");
            if (t.category_id && payeeCategories[t.payee_id] && !payeeCategories[t.payee_id].has(t.category_id)) {
              const priorNames = [...payeeCategories[t.payee_id].values()].join(", ");
              flags.push(`category_drift:was_${priorNames}`);
            }
          }
        }
        return { ...t, flags };
      }

      const flaggedTxns = txns.map(flagTransaction);

      const isCategorized = (t) => (t.category_id && t.category_name !== "Uncategorized")
        || (t.subtransactions && t.subtransactions.length > 0)
        || t.transfer_account_id;
      const categorized = [], uncategorized = [];
      for (const t of flaggedTxns) (isCategorized(t) ? categorized : uncategorized).push(t);

      // Compact projection: only the fields needed to act on a transaction
      const slimTx = (t) => ({
        id: t.id,
        date: t.date,
        payee_name: t.payee_name,
        amount: t.amount,
        category_name: t.category_name,
        account_name: t.account_name,
        flags: t.flags,
      });

      // Group categorized transactions by payee for easier per-group review
      const byPayee = {};
      for (const t of categorized) {
        const key = t.payee_name || "Unknown Payee";
        if (!byPayee[key]) byPayee[key] = { payee: key, category_name: t.category_name, transactions: [] };
        byPayee[key].transactions.push(t);
      }
      const groups = Object.values(byPayee).map((g) => {
        // Aggregate flags across all transactions in the group (deduplicated)
        const allFlags = [...new Set(g.transactions.flatMap((t) => t.flags))];
        const base = {
          payee: g.payee,
          category_name: g.category_name,
          count: g.transactions.length,
          total: round2(g.transactions.reduce((sum, t) => sum + t.amount, 0)),
          flags: allFlags,
        };
        return summary ? base : { ...base, transactions: compact ? g.transactions.map(slimTx) : g.transactions };
      });

      // Build uncategorized payload — full transactions by default, by-payee aggregates when summary:true
      const uncategorizedPayload = (() => {
        if (!summary) return compact ? uncategorized.map(slimTx) : uncategorized;
        const byPayeeUncat = {};
        for (const t of uncategorized) {
          const key = t.payee_name || "Unknown Payee";
          if (!byPayeeUncat[key]) byPayeeUncat[key] = { payee_name: key, count: 0, total: 0, flags: new Set() };
          byPayeeUncat[key].count += 1;
          byPayeeUncat[key].total += t.amount;
          for (const f of t.flags) byPayeeUncat[key].flags.add(f);
        }
        return Object.values(byPayeeUncat).map((g) => ({
          payee_name: g.payee_name,
          count: g.count,
          total: round2(g.total),
          flags: [...g.flags],
        }));
      })();

      const needsCategoryFirst = {
        count: uncategorized.length,
        warning: "Do NOT approve these without assigning a category first",
      };
      if (summary) {
        needsCategoryFirst.payees = uncategorizedPayload;
      } else {
        needsCategoryFirst.transactions = uncategorizedPayload;
      }

      return ok({
        total: flaggedTxns.length,
        summary: !!summary,
        ready_to_approve: {
          count: categorized.length,
          by_payee: groups,
        },
        needs_category_first: needsCategoryFirst,
      });
    })
);

registerTool(
  "get_overspent_categories",
  { description: "Get all categories with a negative balance for a given month. Use this to find prior-month overspends that are silently reducing the current month's Ready to Assign.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
  } },
  ({ budgetId, month }) =>
    run(async () => {
      const { data } = await api.months.getBudgetMonth(resolveBudgetId(budgetId), month);
      const overspent = (data.month.categories || [])
        .filter((c) => !c.deleted && c.balance < 0 && c.category_group_name !== "Internal Master Category")
        .map((c) => ({
          id: c.id,
          name: c.name,
          category_group_name: c.category_group_name,
          budgeted: dollars(c.budgeted),
          activity: dollars(c.activity),
          balance: dollars(c.balance),
        }))
        .sort((a, b) => a.balance - b.balance);
      return ok({
        month,
        overspent_count: overspent.length,
        total_overspent: round2(overspent.reduce((sum, c) => sum + c.balance, 0)),
        categories: overspent,
      });
    })
);

registerTool(
  "ynab_auth_status",
  {
    title: "YNAB Auth Status",
    description: "Check whether the YNAB MCP server has credentials configured and whether write tools are enabled.",
    inputSchema: {},
  },
  () => ok(ynabAuthStatus())
);

registerTool(
  "ynab_tool_index",
  {
    title: "YNAB Tool Index",
    description: "Discover the YNAB MCP server tools. Use this when you need YNAB budgets, accounts, categories, payees, transactions, scheduled transactions, unapproved transaction review, approval, or budget cleanup tools.",
    inputSchema: {},
  },
  () => ok({
    server: "mcp-server-for-ynab",
    package: "@oliverames/ynab-mcp-server",
    auth: ynabAuthStatus(),
    writes_enabled: writesEnabled(),
    writes_available: writesEnabled() && !!API_TOKEN,
    tools: listRegisteredYnabTools(),
    execute_with: "ynab_tool_execute",
    write_execute_with: writesEnabled() && !!API_TOKEN ? "ynab_write_tool_execute" : null,
  })
);

registerTool(
  "ynab_tool_execute",
  {
    title: "Execute YNAB Tool",
    description: "Execute an existing read-only YNAB MCP tool by name. Use ynab_tool_index first to discover YNAB tool names, then pass the selected tool_name and its JSON input. Write-capable tools must be called directly or through ynab_write_tool_execute when YNAB_ALLOW_WRITES=1.",
    inputSchema: {
      tool_name: z.string().describe("Existing read-only YNAB tool name, such as review_unapproved, get_transactions, list_categories, search_categories, or search_payees."),
      input: z.record(z.string(), z.any()).optional().describe("JSON input for the selected YNAB tool. Omit or pass an empty object for tools that take no input."),
    },
  },
  async ({ tool_name: toolName, input = {} }) => {
    if (toolName.startsWith("ynab_")) {
      return {
        isError: true,
        content: [{ type: "text", text: "Refusing to execute YNAB discovery helper tools recursively." }],
      };
    }
    if (WRITE_TOOL_METADATA[toolName]) {
      return {
        isError: true,
        content: [{ type: "text", text: `${toolName} is a write-capable YNAB tool. Set YNAB_ALLOW_WRITES=1 and call it directly, or use ynab_write_tool_execute.` }],
      };
    }
    const tool = registeredTools.get(toolName);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown YNAB tool: ${toolName}` }],
      };
    }
    return tool.handler(input);
  }
);

registerTool(
  "ynab_write_tool_execute",
  {
    title: "Execute YNAB Write Tool",
    description: "Execute an existing write-capable YNAB MCP tool by name. This tool is registered only when YNAB_ALLOW_WRITES=1 and requires confirmed:true after explicit user confirmation.",
    inputSchema: {
      confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms this write action."),
      tool_name: z.string().describe("Existing write-capable YNAB tool name, such as update_transaction, update_transactions, approve_transactions, create_transaction, or delete_transaction."),
      input: z.record(z.string(), z.any()).optional().describe("JSON input for the selected YNAB write tool."),
    },
  },
  async ({ tool_name: toolName, input = {} }) => {
    if (toolName.startsWith("ynab_")) {
      return {
        isError: true,
        content: [{ type: "text", text: "Refusing to execute YNAB discovery helper tools recursively." }],
      };
    }
    if (!WRITE_TOOL_METADATA[toolName]) {
      return {
        isError: true,
        content: [{ type: "text", text: `${toolName} is not a write-capable YNAB tool. Use ynab_tool_execute for read-only tools.` }],
      };
    }
    const tool = registeredTools.get(toolName);
    if (!tool) {
      return writeDisabledResult(toolName);
    }
    const confirmedInput = ["approve_transactions", "reassign_payee_transactions"].includes(toolName) && input.confirmed === undefined
      ? { ...input, confirmed: true }
      : input;
    return tool.handler(confirmedInput);
  }
);

// --- Start ---

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(1);
});

const transport = new StdioServerTransport();
await server.connect(transport);
