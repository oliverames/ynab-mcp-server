#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as ynab from "ynab";

// --- Init ---

// Cloudflare Workers (nodejs_compat) can import this module for the exported
// createYnabServer factory, but its fs/child_process stubs throw when invoked.
// Detect Workers so import-time config resolution, the fs undo journal, and
// the stdio autostart are all skipped there.
const IS_CLOUDFLARE_WORKERS = globalThis.navigator?.userAgent === "Cloudflare-Workers";

const BASE_URL = "https://api.ynab.com/v1";
const YNAB_API_HOST = "api.ynab.com";
const MAX_TOKEN_FILE_BYTES = 4096;
const MAX_RESPONSE_BYTES = Math.floor(envNumber("YNAB_MAX_RESPONSE_BYTES", 8388608, { min: 1 }));
const YNAB_RUNTIME_KEYS = [
  "YNAB_API_TOKEN",
  "YNAB_API_TOKEN_FILE",
  "YNAB_OP_PATH",
  "YNAB_BUDGET_ID",
  "YNAB_ALLOW_WRITES",
];

// In Workers there is no local config to resolve (fs would throw); the Worker
// consumer passes credentials and runtime info to createYnabServer directly.
const runtimeConfig = IS_CLOUDFLARE_WORKERS
  ? {
      apiToken: undefined,
      tokenSource: null,
      values: {},
      sources_checked: [],
      config_fallback_disabled: false,
      detected_agent: "unknown",
      tokenLookupError: undefined,
      lookup_errors: [],
    }
  : resolveYnabRuntimeConfig();
const API_TOKEN = runtimeConfig.apiToken;
const tokenLookupError = runtimeConfig.tokenLookupError;
const DEFAULT_BUDGET_ID = runtimeConfig.values.YNAB_BUDGET_ID?.value;
if (!API_TOKEN && !IS_CLOUDFLARE_WORKERS) {
  const fallbackMessage = tokenLookupError
    ? ` ${tokenLookupError}.`
    : " Add YNAB_API_TOKEN to the agent config file, set YNAB_API_TOKEN_FILE, or set YNAB_OP_PATH.";
  console.error(`YNAB_API_TOKEN is required.${fallbackMessage} Starting MCP Server for YNAB in discovery-only mode.`);
}

// --- Helpers ---

// Parse a numeric env var, falling back when it is unset, empty, non-numeric,
// or below `min`. Prevents NaN from silently disabling limits (or busy-looping
// the rate limiter) when a value is mistyped.
function envNumber(name, fallback, { min = 0 } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function resolveYnabRuntimeConfig() {
  const sources = loadYnabSettingSources();
  const values = {};

  for (const key of YNAB_RUNTIME_KEYS) {
    const source = sources.find((candidate) => hasNonEmptyString(candidate.values[key]));
    if (source) {
      values[key] = {
        value: source.values[key].trim(),
        source: source.id,
        source_label: source.label,
        path: source.path,
        section: source.section,
      };
    }
  }

  const lookupErrors = sources
    .flatMap((source) => source.errors || [])
    .filter(Boolean);

  let apiToken = values.YNAB_API_TOKEN?.value;
  let tokenSource = values.YNAB_API_TOKEN || null;

  if (!apiToken && values.YNAB_API_TOKEN_FILE?.value) {
    try {
      const tokenFileContents = readFileSync(values.YNAB_API_TOKEN_FILE.value, "utf8");
      if (Buffer.byteLength(tokenFileContents, "utf8") > MAX_TOKEN_FILE_BYTES) {
        throw new Error(`token file exceeds ${MAX_TOKEN_FILE_BYTES} bytes`);
      }
      apiToken = tokenFileContents.trim();
      tokenSource = {
        source: "token_file",
        source_label: "YNAB_API_TOKEN_FILE",
        path: values.YNAB_API_TOKEN_FILE.value,
      };
    } catch (e) {
      lookupErrors.push(`Could not read YNAB_API_TOKEN_FILE: ${e.message || String(e)}`);
    }
  }

  if (!apiToken && values.YNAB_OP_PATH?.value) {
    try {
      apiToken = execFileSync(
        "op", ["read", values.YNAB_OP_PATH.value],
        { encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      tokenSource = {
        source: "onepassword_cli",
        source_label: "YNAB_OP_PATH via 1Password CLI",
      };
    } catch (e) {
      // ENOENT means the `op` binary itself is absent (containers, hosted
      // deployments like Glama) — name the real problem instead of a generic
      // CLI error so the fix (use YNAB_API_TOKEN) is obvious.
      const message = e?.code === "ENOENT"
        ? "the 1Password CLI (op) is not installed in this environment, so YNAB_OP_PATH is unsupported here. Set YNAB_API_TOKEN instead."
        : e.stderr?.toString().trim() || e.message || "unknown 1Password CLI error";
      lookupErrors.push(`Could not read YNAB_OP_PATH via 1Password CLI: ${message}`);
    }
  }

  return {
    apiToken,
    tokenSource,
    values,
    sources_checked: sources.map((source) => ({
      id: source.id,
      label: source.label,
      path: source.path,
      section: source.section,
      available: source.available,
      keys_found: source.keysFound,
    })),
    config_fallback_disabled: process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK === "1",
    detected_agent: detectAgentRuntime(),
    tokenLookupError: lookupErrors[lookupErrors.length - 1],
    lookup_errors: lookupErrors,
  };
}

function loadYnabSettingSources() {
  const finalize = (sources) => sources.map((source) => ({
    ...source,
    keysFound: YNAB_RUNTIME_KEYS.filter((key) => hasNonEmptyString(source.values[key])),
  }));

  const sources = [{
    id: "process_env",
    label: "process environment",
    path: null,
    section: null,
    available: true,
    values: pickYnabValues(process.env),
    errors: [],
  }];

  if (process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK === "1") {
    return finalize(sources);
  }

  const codexSources = loadCodexConfigSources();
  const claudeSource = loadClaudeSettingsSource();
  if (detectAgentRuntime() === "claude") {
    sources.push(claudeSource, ...codexSources);
  } else {
    sources.push(...codexSources, claudeSource);
  }
  return finalize(sources);
}

function loadCodexConfigSources() {
  const configPath = path.join(userHomeDir(), ".codex", "config.toml");
  const emptySources = [
    configSource("codex_shell_environment", "Codex shell_environment_policy.set", configPath, "shell_environment_policy.set"),
    configSource("codex_mcp_env", "Codex mcp_servers.ynab.env", configPath, "mcp_servers.ynab.env"),
  ];

  let text;
  try {
    text = readFileSync(configPath, "utf8");
  } catch (e) {
    return emptySources.map((source) => ({
      ...source,
      available: false,
      errors: isMissingFileError(e) ? [] : [`Could not read ${configPath}: ${e.message || String(e)}`],
    }));
  }

  const sections = parseSimpleTomlSections(text);
  return emptySources.map((source) => ({
    ...source,
    available: true,
    values: pickYnabValues(sections[source.section] || {}),
    errors: [],
  }));
}

function loadClaudeSettingsSource() {
  const settingsPath = path.join(userHomeDir(), ".claude", "settings.json");
  const source = configSource("claude_settings_env", "Claude settings.json env", settingsPath, "env");

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  } catch (e) {
    return {
      ...source,
      available: false,
      errors: isMissingFileError(e) ? [] : [`Could not read ${settingsPath}: ${e.message || String(e)}`],
    };
  }

  return {
    ...source,
    available: true,
    values: pickYnabValues(settings?.env || {}),
    errors: [],
  };
}

function configSource(id, label, filePath, section) {
  return {
    id,
    label,
    path: filePath,
    section,
    available: false,
    values: {},
    errors: [],
  };
}

function pickYnabValues(source) {
  return Object.fromEntries(
    YNAB_RUNTIME_KEYS
      .filter((key) => hasNonEmptyString(source?.[key]))
      .map((key) => [key, String(source[key])])
  );
}

function parseSimpleTomlSections(text) {
  const sections = {};
  let currentSection = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      sections[currentSection] ||= {};
      continue;
    }

    const assignmentMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignmentMatch || !currentSection) continue;

    const [, key, rawValue] = assignmentMatch;
    const value = parseSimpleTomlString(rawValue);
    if (value !== undefined) {
      sections[currentSection] ||= {};
      sections[currentSection][key] = value;
    }
  }

  return sections;
}

function parseSimpleTomlString(rawValue) {
  const value = stripTomlComment(rawValue).trim();
  if (!value) return undefined;
  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function stripTomlComment(value) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#") {
      return value.slice(0, i);
    }
  }
  return value;
}

function userHomeDir() {
  return process.env.HOME || homedir();
}

function hasNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isMissingFileError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function detectAgentRuntime() {
  if (Object.keys(process.env).some((key) => key.startsWith("CODEX_"))) return "codex";
  if (Object.keys(process.env).some((key) => key.startsWith("CLAUDE_"))) return "claude";
  return "unknown";
}

function buildYnabAuthSetupGuide(agent) {
  const codexPath = path.join(userHomeDir(), ".codex", "config.toml");
  const claudePath = path.join(userHomeDir(), ".claude", "settings.json");
  const shouldShowCodex = agent === "codex" || agent === "unknown";
  const shouldShowClaude = agent === "claude" || agent === "unknown";
  const manualTargets = [];
  const passwordManagerTargets = [];

  if (shouldShowCodex) {
    manualTargets.push({
      agent: "codex",
      path: codexPath,
      section: "shell_environment_policy.set",
      snippet: "[shell_environment_policy.set]\nYNAB_API_TOKEN = \"your-token-here\"",
    });
    passwordManagerTargets.push({
      agent: "codex",
      path: codexPath,
      section: "shell_environment_policy.set",
      snippet: "[shell_environment_policy.set]\nYNAB_OP_PATH = \"op://Personal/YNAB API Token/credential\"",
      note: "Ask the user for permission before editing this config, and confirm the 1Password item path they want to use.",
    });
  }

  if (shouldShowClaude) {
    manualTargets.push({
      agent: "claude",
      path: claudePath,
      section: "env",
      snippet: "{\n  \"env\": {\n    \"YNAB_API_TOKEN\": \"your-token-here\"\n  }\n}",
    });
    passwordManagerTargets.push({
      agent: "claude",
      path: claudePath,
      section: "env",
      snippet: "{\n  \"env\": {\n    \"YNAB_OP_PATH\": \"op://Personal/YNAB API Token/credential\"\n  }\n}",
      note: "Ask the user for permission before editing this config, and confirm the 1Password item path they want to use.",
    });
  }

  return {
    prompt_for_agent: "Ask the user whether they already have a YNAB API key in a password manager such as 1Password. If yes, ask permission to configure YNAB_OP_PATH for this agent. If no, ask them to add YNAB_API_TOKEN to the correct agent config file, then restart the MCP server.",
    detected_agent: agent,
    manual_api_key_targets: manualTargets,
    password_manager_targets: passwordManagerTargets,
    token_file_option: "Alternatively, set YNAB_API_TOKEN_FILE to a small local file containing only the token.",
    restart_required: true,
  };
}

// --- Undo journal storage (Node fs implementation) ---
// The factory takes an injected async journal interface; this is the local-fs
// implementation the stdio bootstrap uses (~/.ynab-mcp-undo.json). The journal
// lives outside the budget, so it survives restarts but never leaves this machine.

const UNDO_JOURNAL_MAX_ENTRIES = 100;

function undoJournalPath() {
  return path.join(userHomeDir(), ".ynab-mcp-undo.json");
}

function readUndoJournal() {
  try {
    const parsed = JSON.parse(readFileSync(undoJournalPath(), "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createFsJournal(filePath) {
  return {
    path: filePath,
    async read() {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
    async persist(entries) {
      writeFileSync(filePath, JSON.stringify(entries.slice(0, UNDO_JOURNAL_MAX_ENTRIES), null, 2));
    },
  };
}

// --- Server factory ---
// Builds the entire tool/prompt/resource layer around injected credentials,
// write gating, undo-journal storage, and auth-status runtime info, so the
// same layer serves both the local stdio process and hosted deployments
// (e.g. a Cloudflare Worker with per-user OAuth tokens).
//
// options:
//   getAccessToken: async () => string|null — called per outbound YNAB request;
//     the returned token replaces any Authorization header (see secureFetch).
//   hasCredentials: boolean — whether a token source exists (gates run()).
//   defaultBudgetId: string|undefined — fallback budget for tools.
//   writesEnabled: boolean — registers write tools when true.
//   journal: { async read(), async persist(entries) } | null — undo storage;
//     null disables journaling (list_undo_history/undo_operation degrade).
//   runtime: { tokenSource, detected_agent, config_fallback_disabled,
//     sources_checked, values, tokenLookupError, setupGuide } — auth-status
//     reporting only; all fields optional.
//   serverInfo: { name, version } override.
export function createYnabServer(options = {}) {

const {
  getAccessToken = null,
  hasCredentials = false,
  defaultBudgetId = undefined,
  writesEnabled: allowWrites = false,
  journal = null,
  runtime = {},
  serverInfo = { name: "YNAB Local", version: "5.1.0" },
} = options;

// Most-recently-seen access token, kept only so sanitizeErrorMessage can
// redact it from error text. Seeded eagerly (best effort) and refreshed on
// every secureFetch call.
let currentToken = null;
if (getAccessToken) {
  Promise.resolve()
    .then(() => getAccessToken())
    .then((token) => { if (token) currentToken = token; })
    .catch(() => {});
}

function resolveBudgetId(input) {
  return input || defaultBudgetId || "last-used";
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

const subtransactionInputSchema = z.object({
  amount: z.number().describe("Subtransaction amount in dollars"),
  categoryId: z.string().optional().describe("Category ID"),
  payeeId: z.string().optional().describe("Payee ID"),
  payeeName: z.string().max(200).optional().describe("Payee name"),
  memo: z.string().optional().describe("Memo"),
});

function mapSubtransactions(subtransactions) {
  return subtransactions.map((s) => ({
    amount: milliunits(s.amount),
    category_id: s.categoryId,
    payee_id: s.payeeId,
    payee_name: s.payeeName,
    memo: s.memo,
  }));
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
    out.subtransactions = mapSubtransactions(t.subtransactions);
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
  if (t.subtransactions !== undefined) {
    out.subtransactions = mapSubtransactions(t.subtransactions);
  }
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

// Refetch all updated transactions in a single list request instead of one
// GET per transaction. Verification previously issued N+1 requests, which
// starved the shared YNAB rate budget (~190 req/hour) on large batches; a
// 100-row approval cost 100 extra GETs. One request now covers the batch,
// with a per-transaction GET fallback only for rows the list did not return.
// Keep the verification list request bounded: a single old transaction in a
// batch must not turn the refetch into a full-history download (which could
// exceed MAX_RESPONSE_BYTES and fail the tool call after the write already
// succeeded). Rows older than the window fall back to per-transaction GETs.
const VERIFY_REFETCH_WINDOW_DAYS = 90;

async function prefetchUpdatedTransactions(budgetId, requestedUpdates, responseTransactions = []) {
  const wantedIds = new Set(requestedUpdates.map((r) => r.id && normalizeTransactionId(r.id)).filter(Boolean));
  const dates = [];
  for (const t of responseTransactions) if (t?.date) dates.push(t.date);
  for (const r of requestedUpdates) if (r.date) dates.push(r.date);

  const byId = new Map();
  if (dates.length > 0) {
    const minDate = dates.reduce((min, d) => (d < min ? d : min));
    const windowStart = new Date(Date.now() - VERIFY_REFETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const sinceDate = minDate > windowStart ? minDate : windowStart;
    try {
      const data = await fetchTransactions({ budgetId, sinceDate });
      for (const t of data.transactions) {
        const id = normalizeTransactionId(t.id);
        if (wantedIds.has(id)) byId.set(id, formatTransaction(t));
      }
    } catch {
      // The write already succeeded; a failed bulk refetch (e.g. a response
      // over MAX_RESPONSE_BYTES on a very busy budget) must not fail the tool
      // call. Fall through to per-transaction GETs below.
    }
  }

  // Fetch stragglers (outside the window, or absent from the list response)
  // concurrently; the shared rate limiter still meters the actual requests.
  const missingIds = [...wantedIds].filter((id) => !byId.has(id));
  await Promise.all(missingIds.map(async (id) => {
    byId.set(id, await getFormattedTransaction(budgetId, id));
  }));
  return byId;
}

async function verifyBulkTransactionUpdates(budgetId, requestedUpdates, responseTransactions) {
  const verification = {
    checked: requestedUpdates.length,
    retried: [],
    failed: [],
  };
  const prefetched = await prefetchUpdatedTransactions(budgetId, requestedUpdates, responseTransactions);
  const results = requestedUpdates.map((requested) => {
    const refetched = prefetched.get(normalizeTransactionId(requested.id));
    return { requested, refetched, mismatches: transactionUpdateMismatches(requested, refetched) };
  });

  // Retry every mismatched row in one bulk PATCH (not one request per row),
  // then independently refetch just those rows to confirm persistence.
  const mismatched = results.filter((r) => r.mismatches.length > 0);
  if (mismatched.length > 0) {
    verification.retried = mismatched.map((r) => ({ id: r.requested.id, mismatches: r.mismatches }));
    // Drop subtransactions from the retry payload: the first PATCH already
    // converted the transaction into a split, and YNAB rejects subtransaction
    // updates on existing splits. Splits are not among the verified fields,
    // so the retry only needs to re-send the scalar fields that mismatched.
    const retryRequests = mismatched.map((r) => ({ ...r.requested, subtransactions: undefined }));
    const { data } = await api.transactions.updateTransactions(budgetId, {
      transactions: retryRequests.map((r) => ({ id: normalizeTransactionId(r.id), ...mapTransactionUpdate(r) })),
    });
    const reprefetched = await prefetchUpdatedTransactions(budgetId, retryRequests, data.transactions);
    for (const r of mismatched) {
      r.refetched = reprefetched.get(normalizeTransactionId(r.requested.id));
      r.mismatches = transactionUpdateMismatches(r.requested, r.refetched);
      if (r.mismatches.length > 0) {
        verification.failed.push({ id: r.requested.id, mismatches: r.mismatches });
      }
    }
  }

  return { verification, verified: results.map((r) => r.refetched) };
}

// YNAB scheduled transactions that realize get composite IDs like `uuid_YYYY-MM-DD`.
// Strip the date suffix so API lookups work correctly.
function normalizeTransactionId(id) {
  return id.replace(/_\d{4}-\d{2}-\d{2}$/, "");
}

// Pretty-print small payloads for readability; large ones (e.g. full budget
// exports) are emitted compactly — indentation inflates a multi-MB result by
// ~30% for no benefit to a machine consumer.
const PRETTY_PRINT_MAX_BYTES = 65536;

function ok(data) {
  const compact = JSON.stringify(data);
  const text = compact.length > PRETTY_PRINT_MAX_BYTES ? compact : JSON.stringify(data, null, 2);
  const content = [{ type: "text", text }];
  // Surface a pacing warning to the model when the trailing-hour request
  // budget runs low (YNAB enforces 200/hour per token; the local limiter is
  // set below that). Silent enforcement alone lets a model burn the budget
  // on low-value calls and then stall mid-workflow.
  const remaining = ynabRequestsRemaining();
  if (remaining !== null && remaining <= 50) {
    content.push({
      type: "text",
      text: `Rate limit warning: about ${remaining} YNAB API requests remaining this hour (limit resets on a rolling window). Prefer delta requests, summary/compact modes, and batch tools until it recovers.`,
    });
  }
  return { content };
}

// Trailing-hour request counter for user-visible pacing warnings. The token
// bucket above enforces the limit; this only reports how much budget is left.
const apiRequestTimes = [];

function recordApiRequest() {
  const now = Date.now();
  apiRequestTimes.push(now);
  while (apiRequestTimes.length > 0 && apiRequestTimes[0] < now - 3600000) {
    apiRequestTimes.shift();
  }
}

function ynabRequestsRemaining() {
  const requestsPerHour = envNumber("YNAB_RATE_LIMIT_PER_HOUR", 190);
  if (requestsPerHour <= 0) return null;
  const cutoff = Date.now() - 3600000;
  const used = apiRequestTimes.filter((t) => t >= cutoff).length;
  return Math.max(0, Math.floor(requestsPerHour) - used);
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

function endOfMonth(month) {
  const match = /^(\d{4})-(\d{2})-01$/.exec(month);
  if (!match) {
    throw new Error("month must be in YYYY-MM-DD format and use the first day of the month.");
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
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
  const hasResourceFilter = Boolean(accountId || categoryId || payeeId);
  const effectiveMonth = hasResourceFilter ? undefined : month;
  const effectiveSinceDate = month && hasResourceFilter ? month : sinceDate;
  const effectiveUntilDate = month && hasResourceFilter ? endOfMonth(month) : untilDate;

  return ynabFetch(buildTransactionListPath({ budgetId, accountId, categoryId, payeeId, month: effectiveMonth }), {
    query: {
      since_date: effectiveSinceDate,
      until_date: effectiveUntilDate,
      type,
      last_knowledge_of_server: lastKnowledgeOfServer,
    },
  });
}

async function run(fn) {
  if (!hasCredentials) {
    return missingCredentialsResult();
  }

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

function missingCredentialsResult() {
  return {
    content: [{ type: "text", text: JSON.stringify({
      error: "missing_credentials",
      message: "YNAB API credentials are not configured for this MCP server process.",
      auth: ynabAuthStatus(),
    }, null, 2) }],
    isError: true,
  };
}

function sanitizeErrorMessage(value) {
  let message = String(value ?? "");
  if (currentToken) {
    message = message.split(currentToken).join("[REDACTED_TOKEN]");
  }
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/Authorization:\s*[^\r\n]+/gi, "Authorization: [REDACTED_TOKEN]");
}

function createYnabRateLimiter() {
  const requestsPerHour = envNumber("YNAB_RATE_LIMIT_PER_HOUR", 190);
  if (requestsPerHour <= 0) {
    return async () => {};
  }

  const burst = Math.max(1, Math.floor(envNumber("YNAB_RATE_LIMIT_BURST", 10, { min: 1 })));
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

const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

function isIdempotentRequest(init) {
  const method = (init.method || "GET").toUpperCase();
  return method === "GET" || method === "HEAD";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt) {
  return Math.min(1000 * 2 ** attempt, 30000);
}

function retryDelayMs(res, attempt) {
  const retryAfter = Number.parseFloat(res.headers.get("retry-after") || "");
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(retryAfter * 1000, 120000);
  }
  return backoffDelayMs(attempt);
}

async function secureFetch(input, init = {}) {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
  assertYnabApiUrl(url);

  // Single token-injection choke point for both SDK-mediated calls and
  // ynabFetch: the injected token replaces whatever Authorization header the
  // ynab SDK set from its construction-time placeholder token.
  const accessToken = getAccessToken ? await getAccessToken() : null;
  if (!accessToken) {
    throw new Error("YNAB access token is unavailable or expired. Reconnect this MCP server to YNAB and try again.");
  }
  currentToken = accessToken;
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${accessToken}`);
  init = { ...init, headers };

  const maxRetries = Math.floor(envNumber("YNAB_HTTP_RETRIES", 2));
  for (let attempt = 0; ; attempt += 1) {
    await ynabRateLimit();
    recordApiRequest();

    let res;
    try {
      res = await fetchOnce(url, init);
    } catch (e) {
      // A network failure can leave a non-idempotent request in an unknown
      // state on the server, so only reads are retried on thrown errors.
      if (attempt < maxRetries && isIdempotentRequest(init)) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw e;
    }

    // 429 means YNAB rejected the request without processing it, so any
    // method is safe to retry; other retryable statuses are reads-only.
    const retryable = res.status === 429
      || (RETRYABLE_HTTP_STATUSES.has(res.status) && isIdempotentRequest(init));
    if (retryable && attempt < maxRetries) {
      await sleep(retryDelayMs(res, attempt));
      continue;
    }

    // Cheap early guard: the header can lie (absent under chunked transfer,
    // compressed size under gzip), so the decoded body is capped below too.
    const contentLength = Number.parseInt(res.headers.get("content-length") || "", 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error(`YNAB response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    return enforceResponseSizeCap(res);
  }
}

const BODYLESS_HTTP_STATUSES = new Set([204, 205, 304]);

// Read the decoded body with a hard byte cap and hand callers an equivalent
// Response. Enforcing this inside secureFetch bounds every request path —
// SDK-mediated calls buffer and parse res.json() with no cap of their own.
async function enforceResponseSizeCap(res) {
  if (!res.body || BODYLESS_HTTP_STATUSES.has(res.status)) return res;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`YNAB response exceeded ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

async function fetchOnce(url, init) {
  const timeoutMs = Math.floor(envNumber("YNAB_HTTP_TIMEOUT_MS", 30000));
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
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));  }
  const opts = {
    method,
    // The Authorization header is injected per-request by secureFetch.
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await secureFetch(url, opts);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(sanitizeErrorMessage(json?.error?.detail || `HTTP ${res.status}`));
    err.error = json?.error ? { ...json.error, detail: sanitizeErrorMessage(json.error.detail) } : undefined;
    throw err;
  }
  return json.data;
}

// --- Server ---

const ynabRateLimit = createYnabRateLimiter();
// The real bearer token is injected per-request by secureFetch (from
// getAccessToken); the SDK is constructed with a placeholder that never
// reaches the wire.
const constructionToken = "token-injected-by-secure-fetch";
const api = new ynab.API(constructionToken, BASE_URL);
// The ynab SDK's Configuration exposes a `config` setter that replaces its
// inner options object; this is how every SDK request is routed through
// secureFetch (host pinning, rate limiting, retries, timeout).
api._configuration.config = { accessToken: constructionToken, basePath: BASE_URL, fetchApi: secureFetch };
if (api._configuration.fetchApi !== secureFetch) {
  // The public Configuration.fetchApi getter is exactly what the SDK's request
  // path reads. Fail loudly rather than silently issuing unprotected requests
  // if a future SDK version changes this contract.
  throw new Error("ynab SDK configuration shape changed: secure fetch wiring did not take effect. Refusing to start.");
}

const server = new McpServer(serverInfo);

const registeredTools = new Map();
const toolCatalog = new Map();

function humanizeToolName(name) {
  return name
    .split("_")
    .map((part) => part.toLowerCase() === "ynab"
      ? "YNAB"
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function completeToolConfig(name, config = {}) {
  const title = config.title ?? humanizeToolName(name);
  return {
    ...config,
    title,
    inputSchema: config.inputSchema ?? {},
    outputSchema: config.outputSchema ?? {
      result: z.unknown().describe(`Structured result returned by ${title}.`),
    },
  };
}

function resultValueFromContent(content = []) {
  const text = content.find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  if (text === undefined) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function withStructuredContent(handler, args, extra) {
  const result = await handler(args, extra);
  if (!result || result.isError || result.structuredContent) return result;
  return {
    ...result,
    structuredContent: { result: resultValueFromContent(result.content) },
  };
}

// Validate executor input against the target tool's schema. Direct MCP calls
// are validated by the SDK; the ynab_tool_execute / ynab_write_tool_execute
// passthroughs would otherwise hand raw JSON to handlers unchecked.
function parseToolExecuteInput(toolName, input) {
  const shape = toolCatalog.get(toolName)?.config?.inputSchema;
  if (!shape) return input ?? {};
  const parsed = z.object(shape).safeParse(input ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(input)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid input for ${toolName}: ${issues}`);
  }
  return parsed.data;
}

function registerTool(name, config, handler) {
  const completedConfig = completeToolConfig(name, config);
  const registration = server.registerTool(name, completedConfig, handler);
  toolCatalog.set(name, { config: completedConfig });
  if (registration !== undefined) {
    registeredTools.set(name, { config: completedConfig, handler });
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
      } else if (!hasCredentials) {
        status = "discoverable_requires_credentials";
      }
      return {
        name,
        title: config?.title ?? name,
        description: isWrite ? withWriteGateDescription(config?.description ?? "") : config?.description ?? "",
        has_input_schema: !!config?.inputSchema,
        has_output_schema: !!config?.outputSchema,
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
  merge_category: { destructiveHint: false, idempotentHint: true },
  retire_category: { destructiveHint: false, idempotentHint: true },
  prepare_split_for_matching: { destructiveHint: false, idempotentHint: false },
  undo_operation: { destructiveHint: false, idempotentHint: true },
};

function writesEnabled() {
  return !!allowWrites;
}

function publicYnabRuntimeSettings() {
  return Object.fromEntries(
    Object.entries(runtime.values ?? {})
      .filter(([key]) => key !== "YNAB_API_TOKEN")
      .map(([key, entry]) => [key, {
        configured: true,
        source: entry.source,
        source_label: entry.source_label,
      }])
  );
}

function ynabAuthSetupGuide() {
  return runtime.setupGuide ?? buildYnabAuthSetupGuide(runtime.detected_agent ?? "unknown");
}

function ynabAuthStatus() {
  const authenticated = !!hasCredentials;
  const writeToolsAvailable = authenticated && writesEnabled();
  return {
    authenticated,
    default_budget_id_configured: !!defaultBudgetId,
    writes_enabled: writesEnabled(),
    write_tools_available: writeToolsAvailable,
    credential_source: runtime.tokenSource?.source ?? null,
    credential_source_label: runtime.tokenSource?.source_label ?? null,
    detected_agent: runtime.detected_agent ?? null,
    config_fallback_disabled: runtime.config_fallback_disabled ?? null,
    configured_settings: publicYnabRuntimeSettings(),
    credential_sources_checked: runtime.sources_checked ?? [],
    lookup_error: authenticated ? null : runtime.tokenLookupError ?? null,
    setup: authenticated ? null : ynabAuthSetupGuide(),
    message: authenticated
      ? "MCP Server for YNAB has an API token configured."
      : "MCP Server for YNAB is running in discovery-only mode. Check setup.prompt_for_agent for the safe credential setup flow, then restart the MCP server before calling API tools.",
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
        idempotentHint: true,
        openWorldHint: false,
      },
    }, (args, extra) => withStructuredContent(handler, args, extra));
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
      openWorldHint: false,
    },
  }, async (args, extra) => {
    if (!writesEnabled()) {
      return writeDisabledResult(name);
    }
    return withStructuredContent(handler, args, extra);
  });
};

// ==================== User & Budgets ====================

registerTool(
  "get_user",
  { description: "Get the authenticated YNAB user (their user ID). Read-only; takes no input. Mainly useful to verify the API token works — for credential/config diagnostics prefer ynab_auth_status, which needs no API request." },
  () =>
  run(async () => {
    const { data } = await api.user.getUser();
    return ok(data.user);
  })
);

function formatBudgetSummary(b) {
  return {
    id: b.id,
    name: b.name,
    last_modified_on: b.last_modified_on,
    first_month: b.first_month,
    last_month: b.last_month,
    date_format: b.date_format,
    currency_format: b.currency_format,
  };
}

registerTool(
  "list_budgets",
  { description: "List all budgets. Use a budget ID from the results in other tools, or omit budgetId to use the last-used budget.", inputSchema: {
    includeAccounts: z.boolean().optional().describe("If true, include each budget's account list in the response"),
  } },
  ({ includeAccounts } = {}) =>
  run(async () => {
    const { data } = await api.plans.getPlans(includeAccounts);
    const plans = data.plans || data.budgets || [];
    const defaultPlan = data.default_plan || data.default_budget;
    const result = {
      budgets: plans.map((b) => {
        const out = formatBudgetSummary(b);
        if (includeAccounts && b.accounts) out.accounts = b.accounts.map(formatAccount);
        return out;
      }),
    };
    if (defaultPlan) {
      result.default_budget = { id: defaultPlan.id, name: defaultPlan.name };
    }
    return ok(result);
  })
);

registerTool(
  "get_budget",
  { description: "Get a budget summary including name, currency format, and account/category/payee counts. Pass lastKnowledgeOfServer to get a delta export instead: every entity (accounts, payees, categories, months, transactions, scheduled transactions, ...) that changed since that server knowledge, plus the new server_knowledge for the next delta request. A delta request with lastKnowledgeOfServer: 0 returns the full budget export, which can be very large — responses over the YNAB_MAX_RESPONSE_BYTES cap (default 8 MB) are rejected; on big budgets prefer incremental deltas or the dedicated list tools.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns changed entities and server_knowledge instead of the summary."),
  } },
  ({ budgetId, lastKnowledgeOfServer }) =>
    run(async () => {
      const { data } = await api.plans.getPlanById(resolveBudgetId(budgetId), lastKnowledgeOfServer);
      const b = data.plan || data.budget;
      if (lastKnowledgeOfServer === undefined) {
        return ok({
          ...formatBudgetSummary(b),
          accounts: b.accounts?.length,
          categories: b.categories?.length,
          payees: b.payees?.length,
        });
      }
      const budget = {
        ...formatBudgetSummary(b),
        accounts: b.accounts?.map(formatAccount),
        payees: b.payees,
        payee_locations: b.payee_locations,
        category_groups: b.category_groups,
        categories: b.categories?.map(formatCategory),
        months: b.months?.map(formatMonth),
        transactions: b.transactions?.map(formatTransaction),
        subtransactions: b.subtransactions?.map(formatSubtransaction),
        scheduled_transactions: b.scheduled_transactions?.map(formatScheduledTransaction),
        scheduled_subtransactions: b.scheduled_subtransactions?.map(formatScheduledSubtransaction),
      };
      return ok(collection(data, "budget", budget, lastKnowledgeOfServer));
    })
);

registerTool(
  "get_budget_settings",
  { description: "Get a budget's settings: currency format (symbol, decimal digits, placement) and date format. Read-only. Use when formatting amounts or dates for display; not needed for tool inputs, which always use dollars and YYYY-MM-DD.", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.plans.getPlanSettingsById(resolveBudgetId(budgetId));
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
  { description: "List all accounts in a budget with balances (dollars), type, closed/on-budget status, last-reconciled time, and debt metadata. Read-only. Use to find account IDs for transaction tools, check balances, or spot direct-import errors (direct_import_in_error). Includes closed accounts; filter on 'closed' if you only want active ones.", inputSchema: {
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
  { description: "Get one account's details: balances (dollars), type, reconciliation timestamp, and debt metadata. Read-only. Prefer list_accounts when comparing several accounts; use this when you already have the account ID and want fresh detail.", inputSchema: {
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
  { description: "Create a new unlinked (manual) account with a starting balance. Side effects: the starting balance posts as a 'Starting Balance' transaction dated today, and an on-budget account's balance adds to Ready to Assign. Cannot create bank-linked accounts (linking happens in the YNAB UI).", inputSchema: {
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
  { description: "List all category groups and their categories with budgeted/activity/balance amounts (dollars) for the current month. Read-only. Use to find category IDs and survey the budget structure; for a specific month's numbers use get_month, and for name-based lookup use search_categories. Hidden and deleted items are included with flags — filter on 'hidden'/'deleted' when presenting.", inputSchema: {
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
  { description: "Get one category's full detail for the current month, including goal/target fields (type, target amount, funding progress). Read-only. Use for goal inspection; for a past or future month's numbers use get_month_category instead.", inputSchema: {
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
  { description: "List all payees with IDs and transfer_account_id (non-null marks a transfer payee — use it as payeeId when creating transfers instead of inventing a 'Transfer : ...' name). Read-only. For name-based lookup prefer search_payees; payee lists on mature budgets can be long.", inputSchema: {
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
  { description: "Get one payee by ID (name, transfer_account_id, deleted flag). Read-only. Mostly useful to confirm a payee still exists or resolve its transfer account; for discovery use search_payees.", inputSchema: {
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
  { description: "Rename a payee. Side effects: the new name appears on every transaction using this payee, past and future. Renaming does not merge payees — to fold one payee's transactions into another use reassign_payee_transactions. Transfer payees cannot be renamed.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    payeeId: z.string().describe("Payee ID"),
    name: z.string().max(500).describe("New payee name (max 500 characters)"),
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
  { description: "Create a new payee by name. Rarely needed: create_transaction with payeeName creates the payee implicitly. Use this only when you want the payee to exist before any transaction does. Side effects: duplicate names are allowed by YNAB — search_payees first to avoid creating a duplicate.", inputSchema: {
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
  { description: "List all payee locations (GPS coordinates YNAB's mobile app recorded at transaction time). Read-only. Only payees with mobile-recorded transactions appear; many budgets have none. Use get_payee_locations_by_payee to scope to one payee.", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.payeeLocations.getPayeeLocations(resolveBudgetId(budgetId));
      return ok(data.payee_locations);
    })
);

registerTool(
  "get_payee_location",
  { description: "Get one payee location record by its ID (payee, latitude, longitude). Read-only; requires a payee-location ID from list_payee_locations.", inputSchema: {
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
  { description: "Get all recorded GPS locations for one payee. Read-only. Useful to confirm which physical merchant an ambiguous payee refers to; empty for payees never used in YNAB's mobile app.", inputSchema: {
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

function formatMonth(m) {
  return withCurrencyFields(
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
  );
}

registerTool(
  "list_months",
  { description: "List all budget months with summary numbers per month (income, budgeted, activity, Ready to Assign, age of money — dollars). Read-only. Use to find which months exist and their headline totals; for per-category detail in one month use get_month.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    lastKnowledgeOfServer: z.number().int().nonnegative().optional().describe("Delta request server knowledge. When provided, returns { months, server_knowledge }."),
  } },
  ({ budgetId, lastKnowledgeOfServer }) =>
    run(async () => {
      const { data } = await api.months.getPlanMonths(resolveBudgetId(budgetId), lastKnowledgeOfServer);
      const months = data.months.map(formatMonth);
      return ok(collection(data, "months", months, lastKnowledgeOfServer));
    })
);

registerTool(
  "get_month",
  { description: "Get one budget month's detail: month totals plus every category's budgeted/activity/balance and goal fields for that month (dollars). Read-only. The workhorse for monthly reviews and budget-vs-actual questions; combine with get_overspent_categories for the negative balances only.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    month: z.string().describe("Month in YYYY-MM-DD format (first of month)"),
  } },
  ({ budgetId, month }) =>
    run(async () => {
      const { data } = await api.months.getPlanMonth(resolveBudgetId(budgetId), month);
      const m = data.month;
      const out = {
        ...formatMonth(m),
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
      return ok(out);
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
  { description: "List all money movements — the history of budget re-allocations between categories (who moved how much from where to where, when). Read-only. Use to answer 'why did this category's assigned amount change'; these are budget moves, not transactions. Can be long on old budgets; prefer get_money_movements_by_month for a specific month.", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/money_movements`);
      return ok(data.money_movements.map(formatMoneyMovement));
    })
);

registerTool(
  "get_money_movements_by_month",
  { description: "Get money movements (category-to-category budget re-allocations) for one month. Read-only. The month-scoped view of list_money_movements; use during month-end review to see how assignments were shuffled.", inputSchema: {
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
  { description: "List all money movement groups — batches of related money movements applied together (e.g. one multi-category re-allocation). Read-only. Join to list_money_movements rows via money_movement_group_id.", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const data = await ynabFetch(`/plans/${resolveBudgetId(budgetId)}/money_movement_groups`);
      return ok(data.money_movement_groups);
    })
);

registerTool(
  "get_money_movement_groups_by_month",
  { description: "Get money movement groups (batched budget re-allocations) for one month. Read-only. The month-scoped view of list_money_movement_groups.", inputSchema: {
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

function formatSubtransaction(s) {
  return withCurrencyFields(
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
  );
}

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
    subtransactions: t.subtransactions?.map(formatSubtransaction),
  };
  return withCurrencyFields(out, t, ["amount"]);
}

registerTool(
  "get_transactions",
  { description: "Get transactions with optional filters. Use type='unapproved' or type='uncategorized' to filter. Optionally filter by account, category, payee, or month. You may combine one of accountId/categoryId/payeeId with month to fetch that resource's transactions for a specific month. Each returned transaction includes 'import_payee_name_original' — the raw merchant string from the bank import (e.g. 'AplPay LS ONION RIVEMONTPELIER VT') — which encodes processor flag, merchant name (often longer than the cleaned payee_name), and city+state. This is the primary disambiguation field when payee_name is truncated or ambiguous. YNAB now defaults omitted sinceDate to one year ago; pass an explicit older sinceDate to retrieve older history. Note: large date ranges (6+ months on a busy budget) can return 50KB+ of data; narrow with categoryId/payeeId/month/sinceDate/untilDate filters when possible.", inputSchema: {
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
      const resourceFilters = [accountId, categoryId, payeeId].filter((value) => value !== undefined && value !== null && value !== "");
      if (resourceFilters.length > 1) {
        throw new Error("Provide only one of accountId, categoryId, or payeeId. You may combine one of these with month.");
      }
      if (month && (sinceDate || untilDate)) {
        throw new Error("Provide either month or sinceDate/untilDate, not both.");
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
  { description: "Create a new transaction. Amounts are in dollars (positive for inflows, negative for outflows). Note: future-dated transactions cannot be created here - use create_scheduled_transaction instead. For transfers between accounts, pass the destination account's transfer_payee_id (from list_accounts) as payeeId — do not pass a 'Transfer : ...' payee name. For manual entry of spend the bank will later import (checks, P2P), use cleared:'uncleared' and NO importId so the import matches instead of duplicating. Creation is journaled and reversible via undo_operation.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    accountId: z.string().describe("Account ID"),    date: z.string().describe("Transaction date (YYYY-MM-DD)"),
    amount: z.number().describe("Amount in dollars (negative for outflows, positive for inflows)"),
    payeeId: z.string().optional().describe("Payee ID"),
    payeeName: z.string().max(200).optional().describe("Payee name (creates new payee if no payeeId)"),
    categoryId: z.string().optional().describe("Category ID"),
    memo: z.string().optional().describe("Transaction memo"),
    cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
    approved: z.boolean().optional().describe("Whether transaction is approved"),
    flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).optional().describe("Flag color"),
    importId: z.string().optional().describe("Unique import ID for deduplication (max 36 chars). If omitted and the transaction is later imported, duplicates may be created."),
    subtransactions: z.array(subtransactionInputSchema).optional().describe("Split transaction into subtransactions. The subtransaction amounts must sum to the total transaction amount."),
  } },
  ({ budgetId, ...txnFields }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const { data } = await api.transactions.createTransaction(bid, {
        transaction: mapTransactionInput(txnFields),
      });
      const created = formatTransaction(data.transaction);
      await appendUndoEntry({
        tool: "create_transaction",
        budget_id: bid,
        description: `Created transaction ${created.id} (${created.payee_name ?? "no payee"}, ${created.amount})`,
        undoable: true,
        undo: { type: "delete_transactions", ids: [created.id] },
      });
      return ok(created);
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
      payeeName: z.string().max(200).optional().describe("Payee name (creates new payee if no payeeId)"),
      categoryId: z.string().optional().describe("Category ID"),
      memo: z.string().optional().describe("Transaction memo"),
      cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
      approved: z.boolean().optional().describe("Whether transaction is approved"),
      flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).optional().describe("Flag color"),
      importId: z.string().optional().describe("Unique import ID for deduplication (max 36 chars)"),
      subtransactions: z.array(subtransactionInputSchema).optional().describe("Split transaction into subtransactions"),
    })).describe("Array of transactions to create"),
  } },
  ({ budgetId, transactions: txns }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const { data } = await api.transactions.createTransactions(bid, {
        transactions: txns.map(mapTransactionInput),
      });
      const created = data.transactions?.map(formatTransaction) ?? [];
      if (created.length > 0) {
        await appendUndoEntry({
          tool: "create_transactions",
          budget_id: bid,
          description: `Created ${created.length} transactions`,
          undoable: true,
          undo: { type: "delete_transactions", ids: created.map((t) => t.id) },
        });
      }
      return ok({
        created,
        duplicate_import_ids: data.duplicate_import_ids,
      });
    })
);

registerTool(
  "update_transaction",
  { description: "Update an existing transaction. Only provided fields are changed. Amounts in dollars. Passing subtransactions converts a non-split transaction into a split (updating the subtransactions of an existing split is not supported by the YNAB API).", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("Transaction ID"),
    accountId: z.string().optional().describe("Account ID"),
    date: z.string().optional().describe("Transaction date (YYYY-MM-DD)"),
    amount: z.number().optional().describe("Amount in dollars"),
    payeeId: z.string().nullable().optional().describe("Payee ID (null to remove)"),
    payeeName: z.string().max(200).nullable().optional().describe("Payee name (null to clear)"),
    categoryId: z.string().nullable().optional().describe("Category ID (null to uncategorize)"),
    memo: z.string().nullable().optional().describe("Transaction memo (null to clear)"),
    cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
    approved: z.boolean().optional().describe("Whether transaction is approved"),
    flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).nullable().optional().describe("Flag color (null to remove)"),
    subtransactions: z.array(subtransactionInputSchema).optional().describe("Convert the transaction into a split. Amounts must sum to the transaction total. Not supported on transactions that are already splits."),
  } },
  ({ budgetId, transactionId, accountId, date, amount, payeeId, payeeName, categoryId, memo, cleared, approved, flagColor, subtransactions }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const requested = { id: transactionId, accountId, date, amount, payeeId, payeeName, categoryId, memo, cleared, approved, flagColor, subtransactions };
      // Capture before-state (one GET) so the change lands in the undo journal.
      let before = null;
      try {
        before = await getFormattedTransaction(bid, transactionId);
      } catch {
        // Missing before-state only degrades undo; the update itself proceeds.
      }
      const { data } = await api.transactions.updateTransaction(bid, transactionId, {
        transaction: mapTransactionUpdate(requested),
      });
      await journalTransactionUpdates(
        "update_transaction",
        bid,
        [requested],
        new Map(before ? [[normalizeTransactionId(transactionId), before]] : []),
        `Updated transaction ${transactionId} (${before?.payee_name ?? "unknown payee"})`
      );
      return ok(formatTransaction(data.transaction));
    })
);

registerTool(
  "delete_transaction",
  { description: "Delete a transaction. Requires confirmed:true after explicit user confirmation.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("Transaction ID"),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms this transaction deletion."),
  } },
  ({ budgetId, transactionId }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const { data } = await api.transactions.deleteTransaction(bid, transactionId);
      const deleted = formatTransaction(data.transaction);
      await appendUndoEntry({
        tool: "delete_transaction",
        budget_id: bid,
        description: `Deleted transaction ${deleted.id} (${deleted.payee_name ?? "no payee"}, ${deleted.amount})`,
        undoable: true,
        undo: { type: "recreate_transaction", transaction: deleted },
      });
      return ok(deleted);
    })
);

registerTool(
  "update_transactions",
  { description: "Batch update multiple transactions. Each transaction object must include its id and the fields to update. IMPORTANT: only use transaction IDs extracted from get_transactions / review_unapproved results — never compose IDs by hand (fabricated IDs return 'transaction does not exist in this budget' errors). For combined category+approval changes, include both 'categoryId' and 'approved: true' in the same entry. This tool refetches each transaction after the bulk update, verifies requested fields actually persisted, and retries mismatches once through single-transaction updates. Never trust review_unapproved counts alone after approving transactions; use this response's verification block or get_transaction to confirm fields.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactions: z
      .array(
        z.object({
          id: z.string().min(1).optional().describe("Transaction ID. Provide either id or importId (not both) to identify the transaction."),
          importId: z.string().min(1).max(36).optional().describe("Import ID used to look up the transaction instead of id. Updating the import_id of an existing transaction is not allowed."),
          accountId: z.string().optional().describe("Account ID"),
          date: z.string().optional().describe("Transaction date (YYYY-MM-DD)"),
          amount: z.number().optional().describe("Amount in dollars"),
          payeeId: z.string().nullable().optional().describe("Payee ID (null to remove)"),
          payeeName: z.string().max(200).nullable().optional().describe("Payee name (null to clear)"),
          categoryId: z.string().nullable().optional().describe("Category ID (null to uncategorize)"),
          memo: z.string().nullable().optional().describe("Transaction memo (null to clear)"),
          cleared: z.enum(["cleared", "uncleared", "reconciled"]).optional().describe("Cleared status"),
          approved: z.boolean().optional().describe("Whether transaction is approved"),
          flagColor: z.enum(["red", "orange", "yellow", "green", "blue", "purple"]).nullable().optional().describe("Flag color (null to remove)"),
          subtransactions: z.array(subtransactionInputSchema).optional().describe("Convert the transaction into a split. Not supported on transactions that are already splits."),
        })
      )
      .describe("Array of transaction updates"),
    returnSummary: z.boolean().optional().describe("If true, return compact counts (updated_count, approved_count, and verification counts) instead of the full updated-transaction objects. Use for large batches (~50+) whose full response would exceed the inline tool-result limit; the write is performed identically either way."),
  } },
  ({ budgetId, transactions: txns, returnSummary }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      for (const t of txns) {
        // Same predicate the mapping below uses; a present-but-empty id must
        // be rejected here, not silently sent to YNAB as the lookup key.
        if ((t.id !== undefined) === (t.importId !== undefined)) {
          throw new Error("Each transaction update must provide exactly one of id or importId.");
        }
      }
      const mapped = txns.map((t) => ({
        ...(t.id !== undefined ? { id: t.id } : { import_id: t.importId }),
        ...mapTransactionUpdate(t),
      }));
      // Capture before-states pre-write for the undo journal (id-based rows
      // only; importId-only rows have no id yet and journal as non-undoable).
      const beforeById = await fetchTransactionsByIds(bid, txns.filter((t) => t.id !== undefined).map((t) => t.id));
      const { data } = await api.transactions.updateTransactions(bid, {
        transactions: mapped,
      });
      // Resolve importId-only entries to real transaction ids (from the PATCH
      // response) so post-write verification can refetch them. YNAB import_ids
      // are only unique per account, so a requested import_id that matches
      // more than one returned transaction is ambiguous — refuse to verify
      // (and potentially retry-write) against the wrong transaction.
      const wantedImportIds = new Set(txns.filter((t) => t.importId !== undefined).map((t) => t.importId));
      const byImportId = new Map();
      const ambiguous = new Set();
      for (const t of data.transactions || []) {
        if (!t.import_id || !wantedImportIds.has(t.import_id)) continue;
        if (byImportId.has(t.import_id) && byImportId.get(t.import_id) !== t.id) ambiguous.add(t.import_id);
        byImportId.set(t.import_id, t.id);
      }
      if (ambiguous.size > 0) {
        throw new Error(`The bulk update was submitted, but these import ids matched multiple updated transactions and cannot be verified safely: ${[...ambiguous].join(", ")}. Inspect them with get_transactions and use transaction ids instead.`);
      }
      const resolved = txns.map((t) => (t.id !== undefined ? t : { ...t, id: byImportId.get(t.importId) }));
      const unresolved = resolved.filter((t) => !t.id).map((t) => t.importId);
      if (unresolved.length > 0) {
        throw new Error(`The bulk update was submitted, but YNAB did not return updated transactions for import ids: ${unresolved.join(", ")}. Verification could not run for those rows; inspect them with get_transactions before retrying.`);
      }
      await journalTransactionUpdates(
        "update_transactions",
        bid,
        resolved,
        beforeById,
        `Bulk-updated ${resolved.length} transactions`
      );
      const { verification, verified } = await verifyBulkTransactionUpdates(bid, resolved, data.transactions);
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
      // The pre-write fetch above is the before-state: every row was unapproved.
      await journalTransactionUpdates(
        "approve_transactions",
        bid,
        updates,
        new Map(txns.map((t) => [normalizeTransactionId(t.id), formatTransaction(t)])),
        `Approved ${updates.length} transactions by filter`
      );
      const { verification, verified } = await verifyBulkTransactionUpdates(bid, updates, updData.transactions);
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
      await journalTransactionUpdates(
        "reassign_payee_transactions",
        bid,
        updates,
        new Map(txns.map((t) => [normalizeTransactionId(t.id), formatTransaction(t)])),
        `Reassigned ${updates.length} transactions from payee ${fromPayeeId} to ${toPayeeId}`
      );
      const { verification, verified } = await verifyBulkTransactionUpdates(bid, updates, updData.transactions);
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
  { description: "Ask YNAB to pull any pending transactions from bank-linked accounts now (same as clicking Import in the UI). Side effects: new imported transactions arrive unapproved; follow with review_unapproved. Returns the imported transaction IDs. No-op when nothing is pending; does not affect unlinked accounts.", inputSchema: { budgetId: z.string().optional().describe("Budget ID (uses default if not provided)") } },
  ({ budgetId }) =>
    run(async () => {
      const { data } = await api.transactions.importTransactions(resolveBudgetId(budgetId));
      return ok(data);
    })
);

// ==================== Scheduled Transactions ====================

function formatScheduledSubtransaction(s) {
  return withCurrencyFields(
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
  );
}

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
    subtransactions: t.subtransactions?.map(formatScheduledSubtransaction),
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
  { description: "Get one scheduled (recurring) transaction by ID: next date, frequency, amount (dollars), payee, category. Read-only. Composite realized-transaction IDs (uuid_YYYY-MM-DD) are not valid here — strip the date suffix or use get_transaction, which handles them.", inputSchema: {
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
  { description: "Create a new scheduled (recurring or future one-time) transaction. Side effects: YNAB will realize it into a real unapproved transaction on each occurrence date. Use frequency:'never' for a single future-dated transaction (create_transaction rejects future dates). For transfers, use the destination account's transfer_payee_id as payeeId.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    accountId: z.string().describe("Account ID"),
    dateFirst: z.string().describe("First occurrence date (YYYY-MM-DD)"),
    frequency: z.enum(["never", "daily", "weekly", "everyOtherWeek", "twiceAMonth", "every4Weeks", "monthly", "everyOtherMonth", "every3Months", "every4Months", "twiceAYear", "yearly", "everyOtherYear"]).describe("Recurrence frequency"),
    amount: z.number().describe("Amount in dollars (negative for outflows)"),
    payeeId: z.string().optional().describe("Payee ID"),
    payeeName: z.string().max(200).optional().describe("Payee name"),
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
  { description: "Update an existing scheduled transaction. Only provided fields are changed; amounts in dollars. Side effects: changes apply to all FUTURE occurrences (already-realized transactions are untouched — edit those with update_transaction). Implementation note: the YNAB API replaces the whole resource, so this tool fetches current values first and merges (costs one extra API request).", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    scheduledTransactionId: z.string().describe("Scheduled transaction ID"),
    accountId: z.string().optional().describe("Account ID"),
    date: z.string().optional().describe("Next occurrence date (YYYY-MM-DD)"),
    frequency: z.enum(["never", "daily", "weekly", "everyOtherWeek", "twiceAMonth", "every4Weeks", "monthly", "everyOtherMonth", "every3Months", "every4Months", "twiceAYear", "yearly", "everyOtherYear"]).optional().describe("Recurrence frequency"),
    amount: z.number().optional().describe("Amount in dollars (negative for outflows)"),
    payeeId: z.string().nullable().optional().describe("Payee ID"),
    payeeName: z.string().max(200).nullable().optional().describe("Payee name"),
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
  { description: "Delete a scheduled transaction. Requires confirmed:true after explicit user confirmation.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    scheduledTransactionId: z.string().describe("Scheduled transaction ID"),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms this scheduled transaction deletion."),
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

      // Fetch unapproved transactions across all history. YNAB defaults an
      // omitted since_date to one year ago, which would silently hide older
      // unapproved transactions from the review queue (approve_transactions
      // already fetches full history; keep the two views consistent).
      const { data: unapprovedData } = await api.transactions.getTransactions(bid, allHistorySinceDate(), "unapproved");
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
      const { data } = await api.months.getPlanMonth(resolveBudgetId(budgetId), month);
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
    server: "YNAB",
    package: "@oliverames/mcp-server-for-ynab",
    auth: ynabAuthStatus(),
    writes_enabled: writesEnabled(),
    writes_available: writesEnabled() && !!hasCredentials,
    tools: listRegisteredYnabTools(),
    execute_with: "ynab_tool_execute",
    write_execute_with: writesEnabled() && !!hasCredentials ? "ynab_write_tool_execute" : null,
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
    let parsedInput;
    try {
      parsedInput = parseToolExecuteInput(toolName, input);
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${e.message}` }],
      };
    }
    return tool.handler(parsedInput);
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
    const confirmedInput = [
      "delete_transaction",
      "delete_scheduled_transaction",
      "approve_transactions",
      "reassign_payee_transactions",
    ].includes(toolName) && input.confirmed === undefined
      ? { ...input, confirmed: true }
      : input;
    let parsedInput;
    try {
      parsedInput = parseToolExecuteInput(toolName, confirmedInput);
    } catch (e) {
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${e.message}` }],
      };
    }
    return tool.handler(parsedInput);
  }
);

// ==================== Undo Journal ====================
// Every transaction-level write is journaled with enough before-state to
// reverse it (pattern adapted from Maronato/ynab-mcp and jeangnc/ynab-mcp-server).
// Storage is the injected async journal interface (local file for stdio, KV
// for hosted deployments); a null journal disables journaling entirely.
// Category/payee/scheduled writes are journaled without undo data
// (undoable: false) — reversing those safely needs human judgment.

async function appendUndoEntry(entry) {
  if (!journal) return null;
  // A journaling failure must never fail the write it describes.
  try {
    const entries = await journal.read();
    entries.unshift({ id: randomUUID(), at: new Date().toISOString(), ...entry });
    await journal.persist(entries.slice(0, UNDO_JOURNAL_MAX_ENTRIES));
    return entries[0].id;
  } catch (e) {
    console.error(`Could not write undo journal: ${sanitizeErrorMessage(e?.message || e)}`);
    return null;
  }
}

// Extract the before-values of exactly the fields a requested update changes,
// so undo restores only what this operation touched.
function beforeFieldsForUpdate(requested, beforeTransaction) {
  if (!beforeTransaction) return null;
  const fields = {};
  for (const [inputField, outputField] of TRANSACTION_UPDATE_VERIFICATION_FIELDS) {
    if (!hasOwn(requested, inputField) || requested[inputField] === undefined) continue;
    fields[inputField] = beforeTransaction[outputField] ?? null;
  }
  return fields;
}

// One list request covering recent history, with per-transaction GET fallback
// only for stragglers — same budget-friendly shape as prefetchUpdatedTransactions.
async function fetchTransactionsByIds(budgetId, ids) {
  const wanted = new Set(ids.map(normalizeTransactionId));
  const byId = new Map();
  const sinceDate = new Date(Date.now() - VERIFY_REFETCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  try {
    const data = await fetchTransactions({ budgetId, sinceDate });
    for (const t of data.transactions) {
      const id = normalizeTransactionId(t.id);
      if (wanted.has(id)) byId.set(id, formatTransaction(t));
    }
  } catch {
    // Fall through to per-transaction GETs.
  }
  const missing = [...wanted].filter((id) => !byId.has(id));
  await Promise.all(missing.map(async (id) => {
    try {
      byId.set(id, await getFormattedTransaction(budgetId, id));
    } catch {
      // Missing before-state degrades that row to undoable: false; it must
      // not block the write.
    }
  }));
  return byId;
}

async function journalTransactionUpdates(tool, budgetId, requestedUpdates, beforeById, description) {
  const rows = [];
  let missingBefore = 0;
  for (const requested of requestedUpdates) {
    const before = beforeById.get(normalizeTransactionId(requested.id));
    const fields = beforeFieldsForUpdate(requested, before);
    if (fields && Object.keys(fields).length > 0) {
      rows.push({ id: normalizeTransactionId(requested.id), fields });
    } else {
      missingBefore += 1;
    }
  }
  return appendUndoEntry({
    tool,
    budget_id: budgetId,
    description,
    undoable: rows.length > 0,
    rows_without_before_state: missingBefore,
    undo: rows.length > 0 ? { type: "restore_fields", rows } : null,
  });
}

registerTool(
  "list_undo_history",
  { description: "List the local undo journal: every write this MCP server performed (most recent first), with per-entry undo capability. Read-only; reads a local journal file, never the YNAB API. Use this to review what changed before calling undo_operation, or to audit a session's writes. Entries with undoable:false are recorded for audit only and cannot be reversed automatically.", inputSchema: {
    limit: z.number().int().positive().max(UNDO_JOURNAL_MAX_ENTRIES).optional().describe("Maximum entries to return (default 20, newest first)"),
  } },
  async ({ limit }) => {
    if (!journal) {
      return ok({ count: 0, journal_path: null, entries: [], note: "undo journal unavailable in this deployment" });
    }
    const entries = (await journal.read()).slice(0, limit ?? 20);
    return ok({
      count: entries.length,
      journal_path: journal.path ?? null,
      entries: entries.map((e) => ({
        id: e.id,
        at: e.at,
        tool: e.tool,
        description: e.description,
        undoable: !!e.undoable,
        undone: !!e.undone,
      })),
    });
  }
);

registerTool(
  "undo_operation",
  { description: "Reverse a previous write recorded in the undo journal (see list_undo_history for entry IDs). Supported reversals: field updates are restored to their captured before-values, created transactions are deleted, and deleted transactions are recreated (without their original bank-import linkage, which the YNAB API cannot restore). Side effects: performs real writes against the budget. An entry can only be undone once. Not supported for category/payee/scheduled writes (journaled as undoable:false). Requires confirmed:true after explicit user confirmation.", inputSchema: {
    entryId: z.string().describe("Undo journal entry ID from list_undo_history"),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms this undo."),
  } },
  ({ entryId }) =>
    run(async () => {
      if (!journal) throw new Error("The undo journal is unavailable in this deployment, so undo_operation cannot run.");
      const entries = await journal.read();
      const entry = entries.find((e) => e.id === entryId);
      if (!entry) throw new Error(`No undo journal entry with id ${entryId}. Use list_undo_history to find entry IDs.`);
      if (entry.undone) throw new Error(`Entry ${entryId} was already undone at ${entry.undone_at}.`);
      if (!entry.undoable || !entry.undo) throw new Error(`Entry ${entryId} (${entry.tool}) is journaled for audit only and cannot be undone automatically.`);

      const bid = entry.budget_id;
      let result;      if (entry.undo.type === "restore_fields") {
        const updates = entry.undo.rows.map((r) => ({ id: r.id, ...r.fields }));
        const mapped = updates.map((t) => ({ id: t.id, ...mapTransactionUpdate(t) }));
        const { data } = await api.transactions.updateTransactions(bid, { transactions: mapped });
        const { verification } = await verifyBulkTransactionUpdates(bid, updates, data.transactions);
        if (verification.failed.length > 0) {
          throw new Error(`Undo applied but verification failed for: ${JSON.stringify(verification.failed)}`);
        }
        result = { restored_count: updates.length };
      } else if (entry.undo.type === "delete_transactions") {
        for (const id of entry.undo.ids) {
          await api.transactions.deleteTransaction(bid, id);
        }
        result = { deleted_count: entry.undo.ids.length };
      } else if (entry.undo.type === "recreate_transaction") {
        const t = entry.undo.transaction;
        const { data } = await api.transactions.createTransaction(bid, {
          transaction: mapTransactionInput({
            accountId: t.account_id,
            date: t.date,
            amount: t.amount,
            payeeId: t.payee_id,
            categoryId: t.category_id,
            memo: t.memo,
            cleared: t.cleared,
            approved: t.approved,
            flagColor: t.flag_color,
          }),
        });
        result = { recreated_transaction: formatTransaction(data.transaction) };
      } else {
        throw new Error(`Unknown undo type: ${entry.undo.type}`);
      }

      entry.undone = true;
      entry.undone_at = new Date().toISOString();
      try {
        await journal.persist(entries.slice(0, UNDO_JOURNAL_MAX_ENTRIES));
      } catch (e) {
        console.error(`Could not mark undo entry as undone: ${sanitizeErrorMessage(e?.message || e)}`);
      }
      await appendUndoEntry({
        tool: "undo_operation",
        budget_id: bid,
        description: `Undid entry ${entryId} (${entry.tool}: ${entry.description})`,
        undoable: false,
        undo: null,
      });
      return ok({ undone_entry: entryId, original_tool: entry.tool, ...result });
    })
);

// ==================== Category Workflows ====================
// The YNAB API has no category merge or delete endpoint (its category paths
// support only GET/POST/PATCH), so these are composite workflows: move the
// transactions, move or zero the budgeted amounts, then the empty category
// is retired by hand in the YNAB UI. Adapted from justmytwospence/ynab-mcp.

const MAX_BUDGET_MOVE_MONTHS = 24;

async function reassignCategoryTransactions(bid, fromCategoryId, toCategoryId) {
  const data = await fetchTransactions({ budgetId: bid, categoryId: fromCategoryId, sinceDate: allHistorySinceDate() });
  // The category-transactions endpoint returns hybrid rows: real transactions
  // plus subtransaction rows from splits. Subtransaction rows cannot be
  // PATCHed directly, so they are reported for manual follow-up instead.
  const rows = data.transactions.filter((t) => !t.deleted);
  const txns = rows.filter((t) => t.type !== "subtransaction");
  const subRows = rows.filter((t) => t.type === "subtransaction");
  if (txns.length === 0) {
    return { reassigned_count: 0, skipped_subtransaction_rows: subRows.length };
  }
  const updates = txns.map((t) => ({ id: normalizeTransactionId(t.id), categoryId: toCategoryId }));
  const mapped = updates.map((t) => ({ id: t.id, ...mapTransactionUpdate(t) }));
  const { data: updData } = await api.transactions.updateTransactions(bid, { transactions: mapped });
  const { verification } = await verifyBulkTransactionUpdates(bid, updates, updData.transactions);
  if (verification.failed.length > 0) {
    throw new Error(`Category reassignment verification failed: ${JSON.stringify(verification.failed)}`);
  }
  return {
    reassigned_count: updates.length,
    skipped_subtransaction_rows: subRows.length,
    before_categories: txns,
  };
}

function currentBudgetMonth() {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

async function moveCategoryBudgets(bid, fromCategoryId, toCategoryId, monthsMode) {
  if (monthsMode === "none") return { months_adjusted: [], months_scanned: 0 };
  let months;
  if (monthsMode === "current") {
    months = [currentBudgetMonth()];
  } else {
    const { data } = await api.months.getPlanMonths(bid);
    months = data.months
      .map((m) => m.month)
      .sort()
      .reverse()
      .slice(0, MAX_BUDGET_MOVE_MONTHS);
  }
  const adjusted = [];
  for (const month of months) {
    const { data } = await api.categories.getMonthCategoryById(bid, month, fromCategoryId);
    const budgeted = data.category.budgeted;
    if (!budgeted) continue;
    if (toCategoryId) {
      const { data: target } = await api.categories.getMonthCategoryById(bid, month, toCategoryId);
      await api.categories.updateMonthCategory(bid, month, toCategoryId, {
        category: { budgeted: target.category.budgeted + budgeted },
      });
    }
    await api.categories.updateMonthCategory(bid, month, fromCategoryId, {
      category: { budgeted: 0 },
    });
    adjusted.push({ month, moved: dollars(budgeted) });
  }
  return { months_adjusted: adjusted, months_scanned: months.length };
}

registerTool(
  "merge_category",
  { description: "Merge one category into another: every transaction in fromCategoryId is recategorized to toCategoryId, and budgeted amounts are moved (per moveBudgetedMonths). Use to consolidate duplicate or obsolete categories. The YNAB API cannot delete categories, so the emptied source category remains and must be hidden or deleted by hand in the YNAB UI afterward. Split-transaction sub-rows in the source category are reported but not moved (the API cannot edit existing splits) — handle those in the UI. Side effects: bulk transaction updates plus per-month budget updates; with moveBudgetedMonths='all' this scans up to 24 months and can use many API requests. The transaction recategorization is journaled and reversible via undo_operation; budget moves are not. Requires confirmed:true after explicit user confirmation.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    fromCategoryId: z.string().describe("Source category to empty (its transactions and budgets move out)"),
    toCategoryId: z.string().describe("Destination category that absorbs the transactions and budgeted amounts"),
    moveBudgetedMonths: z.enum(["none", "current", "all"]).optional().describe("Which months' budgeted amounts to move to the destination: 'current' (default) only the current month, 'all' every month with a nonzero source budget (newest 24 months), 'none' to move transactions only"),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms this category merge."),
  } },
  ({ budgetId, fromCategoryId, toCategoryId, moveBudgetedMonths }) =>
    run(async () => {
      if (fromCategoryId === toCategoryId) throw new Error("fromCategoryId and toCategoryId must differ.");
      const bid = resolveBudgetId(budgetId);
      const reassigned = await reassignCategoryTransactions(bid, fromCategoryId, toCategoryId);
      if (reassigned.before_categories) {
        await journalTransactionUpdates(
          "merge_category",
          bid,
          reassigned.before_categories.map((t) => ({ id: normalizeTransactionId(t.id), categoryId: toCategoryId })),
          new Map(reassigned.before_categories.map((t) => [normalizeTransactionId(t.id), formatTransaction(t)])),
          `Merged category ${fromCategoryId} into ${toCategoryId} (${reassigned.reassigned_count} transactions)`
        );
      }
      const budgets = await moveCategoryBudgets(bid, fromCategoryId, toCategoryId, moveBudgetedMonths ?? "current");
      return ok({
        from_category_id: fromCategoryId,
        to_category_id: toCategoryId,
        reassigned_count: reassigned.reassigned_count,
        skipped_subtransaction_rows: reassigned.skipped_subtransaction_rows,
        budget_moves: budgets,
        note: "Source category is now empty but still exists; hide or delete it in the YNAB UI (the API cannot delete categories).",
      });
    })
);

registerTool(
  "retire_category",
  { description: "Prepare a category for deletion: recategorize its full transaction history to replacementCategoryId and zero its budgeted amounts (per zeroBudgetedMonths). The YNAB API has no category-delete endpoint, so the final hide/delete step happens by hand in the YNAB UI — this tool does everything the API can. Split-transaction sub-rows are reported but not moved. Side effects: bulk transaction updates plus per-month budget zeroing; zeroed budget dollars return to Ready to Assign for those months rather than moving to the replacement category (use merge_category if the dollars should follow). The recategorization is journaled and reversible via undo_operation. Requires confirmed:true after explicit user confirmation.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    categoryId: z.string().describe("Category to retire"),
    replacementCategoryId: z.string().describe("Category that absorbs the transaction history"),
    zeroBudgetedMonths: z.enum(["none", "current", "all"]).optional().describe("Which months' budgeted amounts to zero: 'current' (default), 'all' (newest 24 months), or 'none'"),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms retiring this category."),
  } },
  ({ budgetId, categoryId, replacementCategoryId, zeroBudgetedMonths }) =>
    run(async () => {
      if (categoryId === replacementCategoryId) throw new Error("categoryId and replacementCategoryId must differ.");
      const bid = resolveBudgetId(budgetId);
      const reassigned = await reassignCategoryTransactions(bid, categoryId, replacementCategoryId);
      if (reassigned.before_categories) {
        await journalTransactionUpdates(
          "retire_category",
          bid,
          reassigned.before_categories.map((t) => ({ id: normalizeTransactionId(t.id), categoryId: replacementCategoryId })),
          new Map(reassigned.before_categories.map((t) => [normalizeTransactionId(t.id), formatTransaction(t)])),
          `Retired category ${categoryId}; history moved to ${replacementCategoryId} (${reassigned.reassigned_count} transactions)`
        );
      }
      const budgets = await moveCategoryBudgets(bid, categoryId, null, zeroBudgetedMonths ?? "current");
      return ok({
        category_id: categoryId,
        replacement_category_id: replacementCategoryId,
        reassigned_count: reassigned.reassigned_count,
        skipped_subtransaction_rows: reassigned.skipped_subtransaction_rows,
        budget_zeroing: budgets,
        note: "Category is now empty; hide or delete it in the YNAB UI (Budget view → category → hide/delete). Zeroed budget dollars returned to Ready to Assign.",
      });
    })
);

registerTool(
  "prepare_split_for_matching",
  { description: "Work around the YNAB API's inability to split an already-imported transaction: creates a NEW unapproved, uncleared split transaction with the given subtransactions, mirroring the original's account, date, amount, and payee. YNAB then offers to match it with the imported original in the web/mobile UI; approving that match merges the split onto the bank-linked transaction, preserving import linkage. Workflow: call this, then tell the user to open YNAB and approve the suggested match. Side effects: creates one real transaction; if the user never matches it, it should be deleted (the creation is journaled and reversible via undo_operation). The subtransaction amounts must sum exactly to the original amount. Requires confirmed:true after explicit user confirmation. Adapted from dgalarza/ynab-mcp-dgalarza.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    transactionId: z.string().describe("The existing imported transaction to mirror (its account, date, amount, and payee are copied)"),
    subtransactions: z.array(subtransactionInputSchema).min(2).describe("The split lines. Amounts are in dollars and must sum to the original transaction's amount."),
    confirmed: z.literal(true).describe("Required. Pass true only after the user explicitly confirms creating the mirror split transaction."),
  } },
  ({ budgetId, transactionId, subtransactions }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const original = await getFormattedTransaction(bid, transactionId);
      const splitSum = round2(subtransactions.reduce((sum, s) => sum + s.amount, 0));
      if (splitSum !== round2(original.amount)) {
        throw new Error(`Subtransaction amounts sum to ${splitSum} but the original transaction amount is ${original.amount}; they must match exactly.`);
      }
      const { data } = await api.transactions.createTransaction(bid, {
        transaction: mapTransactionInput({
          accountId: original.account_id,
          date: original.date,
          amount: original.amount,
          payeeId: original.payee_id,
          memo: original.memo,
          cleared: "uncleared",
          approved: false,
          subtransactions,
        }),
      });
      const created = formatTransaction(data.transaction);
      await appendUndoEntry({
        tool: "prepare_split_for_matching",
        budget_id: bid,
        description: `Created mirror split ${created.id} for imported transaction ${transactionId}`,
        undoable: true,
        undo: { type: "delete_transactions", ids: [created.id] },
      });
      return ok({
        created_split: created,
        original_transaction_id: transactionId,
        next_step: "Open YNAB (web or mobile); it should suggest matching this new split with the imported original. Approving the match merges them and preserves the bank-import link. If no match is offered, delete the created transaction (see undo_operation).",
      });
    })
);

// ==================== Audits ====================

registerTool(
  "audit_credit_card_payments",
  { description: "Read-only audit of credit card payment categories: for each open credit card / line of credit account, compares the card's balance with its Credit Card Payment category's available balance. In a healthy budget the payment category equals the card balance (sign-flipped) for spending that is budgeted; a shortfall means a future payment is not fully funded (common after overspending or direct debt increases). Reports each card's balance, payment-category balance, difference, and a status. Makes no changes — fix shortfalls by assigning to the payment category via update_month_category. Interpretation note: small transient differences appear while recent transactions are pending/uncleared; treat sub-dollar or same-day differences as timing, not error.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
  } },
  ({ budgetId }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const [{ data: acctData }, { data: catData }] = await Promise.all([
        api.accounts.getAccounts(bid),
        api.categories.getCategories(bid),
      ]);
      const ccCategories = new Map();
      for (const g of catData.category_groups) {
        if (g.name !== "Credit Card Payments") continue;
        for (const c of g.categories) {
          if (!c.deleted) ccCategories.set(c.name, c);
        }
      }
      const cards = acctData.accounts
        .filter((a) => !a.deleted && !a.closed && (a.type === "creditCard" || a.type === "lineOfCredit"))
        .map((a) => {
          const cat = ccCategories.get(a.name);
          const cardBalance = dollars(a.balance);
          const paymentAvailable = cat ? dollars(cat.balance) : null;
          const funded = paymentAvailable !== null ? round2(paymentAvailable + cardBalance) : null;
          let status;
          if (!cat) status = "no_payment_category_found";
          else if (cardBalance >= 0) status = "paid_off_or_positive";
          else if (funded >= -0.005) status = "fully_funded";
          else status = "underfunded";
          return {
            account_id: a.id,
            account_name: a.name,
            card_balance: cardBalance,
            payment_category_id: cat?.id ?? null,
            payment_category_available: paymentAvailable,
            difference: funded,
            status,
          };
        });
      const underfunded = cards.filter((c) => c.status === "underfunded");
      return ok({
        cards,
        underfunded_count: underfunded.length,
        total_underfunded: round2(underfunded.reduce((sum, c) => sum + c.difference, 0)),
        how_to_fix: "Assign the shortfall to the card's Credit Card Payment category with update_month_category (payment category balance should equal the card balance, sign-flipped, when all card spending is budgeted).",
      });
    })
);

registerTool(
  "audit_account_reconciliation",
  { description: "Read-only reconciliation diagnosis. Without accountId: summarizes every open account's last-reconciled date and cleared/uncleared balances (one API request). With accountId: additionally lists that account's uncleared and unapproved transactions since the last reconciliation, which are exactly the rows to compare against the bank statement. Makes no changes — actual reconciliation (marking transactions reconciled and locking the balance) happens in the YNAB UI; use this to find what needs attention first. Interpretation note: an old last_reconciled_at is not itself a problem if cleared_balance matches the bank; uncleared transactions older than a few days are the usual culprits.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    accountId: z.string().optional().describe("Account to inspect in detail (adds that account's uncleared/unapproved transaction list)"),
  } },
  ({ budgetId, accountId }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const { data } = await api.accounts.getAccounts(bid);
      const accounts = data.accounts
        .filter((a) => !a.deleted && !a.closed && (!accountId || a.id === accountId))
        .map((a) => ({
          account_id: a.id,
          account_name: a.name,
          type: a.type,
          last_reconciled_at: a.last_reconciled_at,
          cleared_balance: dollars(a.cleared_balance),
          uncleared_balance: dollars(a.uncleared_balance),
          balance: dollars(a.balance),
          needs_attention: a.uncleared_balance !== 0,
        }));
      if (accountId && accounts.length === 0) throw new Error(`No open account with id ${accountId}.`);
      const result = { accounts };
      if (accountId) {
        const account = accounts[0];
        const since = account.last_reconciled_at
          ? account.last_reconciled_at.slice(0, 10)
          : allHistorySinceDate();
        const txData = await fetchTransactions({ budgetId: bid, accountId, sinceDate: since });
        const open = txData.transactions.filter((t) => !t.deleted && (t.cleared === "uncleared" || !t.approved));
        result.detail = {
          account_id: accountId,
          since,
          open_items_count: open.length,
          open_items: open.map((t) => ({
            id: t.id,
            date: t.date,
            payee_name: t.payee_name,
            amount: dollars(t.amount),
            cleared: t.cleared,
            approved: t.approved,
          })),
          guidance: "Compare open_items against the bank statement. Items on the statement should be marked cleared (update_transaction cleared:'cleared'); items missing from the bank after several days may be duplicates or manual entries needing review.",
        };
      }
      return ok(result);
    })
);

// ==================== Analytics ====================
// Deterministic, read-only analytics computed from transaction history.
// Adapted from Maronato/ynab-mcp; thresholds and formulas follow standard
// personal-finance guidance (savings rate = (income - spending) / income).

function isTransfer(t) {
  return !!t.transfer_account_id;
}

function isIncome(t) {
  return !isTransfer(t) && t.amount > 0 && (t.category_name === "Inflow: Ready to Assign" || t.category_name === "To be Budgeted");
}

function summarizeIncomeExpenseByMonth(transactions) {
  const byMonth = new Map();
  for (const t of transactions) {
    if (t.deleted || isTransfer(t)) continue;
    const month = t.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { income: 0, spending: 0 });
    const bucket = byMonth.get(month);
    if (isIncome(t)) bucket.income += t.amount;
    else if (t.amount < 0) bucket.spending += -t.amount;
  }
  return [...byMonth.entries()].sort().map(([month, { income, spending }]) => ({
    month,
    income: round2(income),
    spending: round2(spending),
    net: round2(income - spending),
    savings_rate_pct: income > 0 ? round2(((income - spending) / income) * 100) : null,
  }));
}

registerTool(
  "get_income_expense_summary",
  { description: "Read-only income vs. spending summary by month, computed from transaction history. Income counts non-transfer inflows to 'Inflow: Ready to Assign'; spending counts non-transfer outflows; transfers and deleted transactions are excluded, so credit card payments do not double-count. Includes per-month savings rate ((income - spending) / income). Use for savings-rate reports, month-end closes, and trend questions like 'am I saving enough'. Refunds appear as negative spending months' offsets, not income.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    sinceDate: z.string().optional().describe("Start of the window (YYYY-MM-DD). Defaults to 6 full months back."),
    untilDate: z.string().optional().describe("End of the window (YYYY-MM-DD). Defaults to today."),
  } },
  ({ budgetId, sinceDate, untilDate }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const defaultSince = new Date(Date.now() - 183 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const data = await fetchTransactions({ budgetId: bid, sinceDate: sinceDate || defaultSince, untilDate });
      const txns = data.transactions.map((t) => ({ ...t, amount: dollars(t.amount) }));
      const months = summarizeIncomeExpenseByMonth(txns);
      const totals = months.reduce((acc, m) => ({ income: acc.income + m.income, spending: acc.spending + m.spending }), { income: 0, spending: 0 });
      return ok({
        months,
        totals: {
          income: round2(totals.income),
          spending: round2(totals.spending),
          net: round2(totals.income - totals.spending),
          savings_rate_pct: totals.income > 0 ? round2(((totals.income - totals.spending) / totals.income) * 100) : null,
        },
      });
    })
);

const RECURRING_CADENCES = [
  { name: "weekly", days: 7, tolerance: 2 },
  { name: "biweekly", days: 14, tolerance: 3 },
  { name: "monthly", days: 30, tolerance: 5 },
  { name: "quarterly", days: 91, tolerance: 10 },
  { name: "yearly", days: 365, tolerance: 20 },
];

function detectRecurringFromTransactions(transactions, { minOccurrences = 3 } = {}) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.deleted || isTransfer(t) || t.amount >= 0) continue;
    const key = `${t.payee_name || t.payee_id || "unknown"}|${round2(t.amount)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const recurring = [];
  for (const txns of groups.values()) {
    if (txns.length < minOccurrences) continue;
    const dates = txns.map((t) => new Date(`${t.date}T00:00:00Z`).getTime()).sort((a, b) => a - b);
    const gaps = [];
    for (let i = 1; i < dates.length; i += 1) gaps.push((dates[i] - dates[i - 1]) / 86400000);
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const cadence = RECURRING_CADENCES.find((c) => Math.abs(avgGap - c.days) <= c.tolerance);
    if (!cadence) continue;
    const sample = txns[0];
    const perYear = 365 / cadence.days;
    recurring.push({
      payee_name: sample.payee_name,
      payee_id: sample.payee_id,
      amount: round2(sample.amount),
      category_name: sample.category_name,
      cadence: cadence.name,
      occurrences: txns.length,
      first_seen: txns.reduce((min, t) => (t.date < min ? t.date : min), txns[0].date),
      last_seen: txns.reduce((max, t) => (t.date > max ? t.date : max), txns[0].date),
      estimated_annual_cost: round2(-sample.amount * perYear),
    });
  }
  return recurring.sort((a, b) => b.estimated_annual_cost - a.estimated_annual_cost);
}

registerTool(
  "detect_recurring_charges",
  { description: "Read-only detection of recurring charges (subscriptions, utilities, insurance) from transaction history: groups outflows by payee + exact amount and reports groups whose spacing matches a weekly/biweekly/monthly/quarterly/yearly cadence, with estimated annual cost. Use for subscription audits and 'what am I paying for' questions. Catches auto-imported recurring charges that list_scheduled_transactions cannot see (that tool only lists manually-created recurrences). Limitations: variable-amount bills (utilities that fluctuate) are missed because grouping is by exact amount; the same vendor billed under multiple identities or payee spellings appears as separate rows — verify against payee variants with search_payees before concluding a subscription was cancelled.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    monthsBack: z.number().int().positive().max(24).optional().describe("History window in months (default 6; longer windows catch quarterly/yearly cadences)"),
    minOccurrences: z.number().int().min(2).optional().describe("Minimum occurrences to count as recurring (default 3)"),
  } },
  ({ budgetId, monthsBack, minOccurrences }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const since = new Date(Date.now() - (monthsBack ?? 6) * 30.5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const data = await fetchTransactions({ budgetId: bid, sinceDate: since });
      const txns = data.transactions.map((t) => ({ ...t, amount: dollars(t.amount) }));
      const recurring = detectRecurringFromTransactions(txns, { minOccurrences: minOccurrences ?? 3 });
      return ok({
        window_since: since,
        recurring_count: recurring.length,
        total_estimated_annual_cost: round2(recurring.reduce((sum, r) => sum + r.estimated_annual_cost, 0)),
        recurring,
      });
    })
);

registerTool(
  "get_budget_health",
  { description: "Read-only budget health snapshot combining month data, account balances, and a trailing-3-month income/spending summary: savings rate, age of money, Ready to Assign, overspent categories, credit card payment funding, and a green/yellow/red indicator per metric. Threshold guidance (standard personal-finance defaults, not YNAB rules): savings rate 20%+ green; carried credit card debt red when payment categories are underfunded; overspent categories yellow. Use as the opening move of a monthly review or 'how am I doing' question, then drill into specific tools. Costs about 4 API requests.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
  } },
  ({ budgetId }) =>
    run(async () => {
      const bid = resolveBudgetId(budgetId);
      const month = currentBudgetMonth();
      const since = new Date(Date.now() - 92 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [{ data: monthData }, { data: acctData }, txData] = await Promise.all([
        api.months.getPlanMonth(bid, month),
        api.accounts.getAccounts(bid),
        fetchTransactions({ budgetId: bid, sinceDate: since }),
      ]);
      const m = monthData.month;
      const txns = txData.transactions.map((t) => ({ ...t, amount: dollars(t.amount) }));
      const months = summarizeIncomeExpenseByMonth(txns);
      const totals = months.reduce((acc, x) => ({ income: acc.income + x.income, spending: acc.spending + x.spending }), { income: 0, spending: 0 });
      const savingsRate = totals.income > 0 ? round2(((totals.income - totals.spending) / totals.income) * 100) : null;

      const overspent = (m.categories || []).filter((c) => !c.deleted && c.balance < 0 && c.category_group_name !== "Internal Master Category");
      const openAccounts = acctData.accounts.filter((a) => !a.deleted && !a.closed);
      const ccAccounts = openAccounts.filter((a) => a.type === "creditCard" || a.type === "lineOfCredit");
      const ccDebt = round2(ccAccounts.reduce((sum, a) => sum + Math.min(0, dollars(a.balance)), 0));

      const indicator = (value, green, yellow) => (value === null ? "unknown" : value ? green : yellow);
      const metrics = {
        savings_rate_pct: {
          value: savingsRate,
          status: savingsRate === null ? "unknown" : savingsRate >= 20 ? "green" : savingsRate >= 0 ? "yellow" : "red",
          guidance: "20%+ is the common target; negative means spending exceeded income over the window.",
        },
        age_of_money_days: {
          value: m.age_of_money ?? null,
          status: m.age_of_money == null ? "unknown" : m.age_of_money >= 30 ? "green" : m.age_of_money >= 10 ? "yellow" : "red",
          guidance: "Days between earning a dollar and spending it; 30+ means roughly a month of buffer.",
        },
        ready_to_assign: {
          value: dollars(m.to_be_budgeted),
          status: m.to_be_budgeted >= 0 ? "green" : "red",
          guidance: "Negative Ready to Assign means more is assigned than exists; move money between categories to fix.",
        },
        overspent_categories: {
          value: overspent.length,
          total: round2(overspent.reduce((sum, c) => sum + dollars(c.balance), 0)),
          status: overspent.length === 0 ? "green" : "yellow",
          guidance: "Cover overspending from other categories before month-end or it reduces next month's Ready to Assign.",
        },
        credit_card_debt: {
          value: ccDebt,
          status: indicator(ccDebt === 0 ? true : null, "green", "yellow") === "green" ? "green" : "yellow",
          guidance: "Card balances are fine when their payment categories are fully funded; run audit_credit_card_payments for the funding check.",
        },
      };
      const statuses = Object.values(metrics).map((x) => x.status);
      const overall = statuses.includes("red") ? "red" : statuses.includes("yellow") ? "yellow" : "green";
      return ok({
        month,
        overall_status: overall,
        metrics,
        trailing_months: months,
        next_steps: "Drill in with get_overspent_categories, audit_credit_card_payments, detect_recurring_charges, or get_income_expense_summary.",
      });
    })
);

// ==================== Export ====================

const CSV_COLUMNS = [
  ["date", (t) => t.date],
  ["amount", (t) => t.amount],
  ["payee", (t) => t.payee_name],
  ["category", (t) => t.category_name],
  ["account", (t) => t.account_name],
  ["memo", (t) => t.memo],
  ["cleared", (t) => t.cleared],
  ["approved", (t) => t.approved],
  ["transfer", (t) => (t.transfer_account_id ? "yes" : "")],
  ["id", (t) => t.id],
];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildTransactionsCsv(transactions) {
  const header = CSV_COLUMNS.map(([name]) => name).join(",");
  const rows = transactions.map((t) => CSV_COLUMNS.map(([, get]) => csvEscape(get(t))).join(","));
  return [header, ...rows].join("\n");
}

registerTool(
  "export_transactions",
  { description: "Export transactions as CSV text (same filters as get_transactions). Columns: date, amount (dollars, negative = outflow), payee, category, account, memo, cleared, approved, transfer, id. Use when the user wants data for a spreadsheet or offline analysis; for programmatic work prefer get_transactions (structured JSON). Read-only. Large date ranges produce large output — narrow with filters when possible.", inputSchema: {
    budgetId: z.string().optional().describe("Budget ID (uses default if not provided)"),
    sinceDate: z.string().optional().describe("Only export transactions on or after this date (YYYY-MM-DD). If omitted, YNAB defaults to one year ago."),
    untilDate: z.string().optional().describe("Only export transactions on or before this date (YYYY-MM-DD)"),
    accountId: z.string().optional().describe("Filter by account ID"),
    categoryId: z.string().optional().describe("Filter by category ID"),
    payeeId: z.string().optional().describe("Filter by payee ID"),
    month: z.string().optional().describe("Filter by month (YYYY-MM-DD, first of month)"),
  } },
  ({ budgetId, sinceDate, untilDate, accountId, categoryId, payeeId, month }) =>
    run(async () => {
      const data = await fetchTransactions({ budgetId, sinceDate, untilDate, accountId, categoryId, payeeId, month });
      const txns = data.transactions.filter((t) => !t.deleted).map(formatTransaction);
      return { content: [{ type: "text", text: buildTransactionsCsv(txns) }] };
    })
);

// ==================== Prompts & Resources ====================
// Workflow prompts and a general-methodology knowledge base, so any MCP host
// gets guided workflows without a separate skill. Patterns adapted from
// Maronato/ynab-mcp and senivel/you-need-an-advisor-mcp. Content is generic
// YNAB methodology — nothing budget-specific.

const YNAB_METHODOLOGY_TEXT = `# YNAB Methodology Primer

## The Four Rules
1. **Give Every Dollar a Job** — assign all of Ready to Assign to categories; a negative Ready to Assign means more is assigned than exists.
2. **Embrace Your True Expenses** — break large irregular costs (insurance, holidays, repairs) into monthly amounts via category targets.
3. **Roll With the Punches** — overspending is fixed by moving money between categories, not by guilt; cover overspent categories before month-end or they reduce next month's Ready to Assign.
4. **Age Your Money** — the age-of-money metric is days between earning and spending; 30+ days means about a month of buffer.

## Credit cards
YNAB treats credit cards as their own accounts with a paired "Credit Card Payment" category. When budgeted cash is spent on a card, YNAB moves that cash into the payment category. A healthy card has payment-category balance equal to the card balance (sign-flipped). A shortfall means future payments are not fully funded (run audit_credit_card_payments).

## Reconciliation
Reconciliation locks the account to the bank's reality: compare the cleared balance to the bank balance, clear transactions the bank shows, investigate uncleared items older than a few days, then finish in the YNAB UI (the API cannot mark an account reconciled). audit_account_reconciliation lists exactly the open items to check.

## Amounts in this server
All tool inputs and outputs use dollars (e.g. -12.34), not YNAB's internal milliunits. Negative = outflow, positive = inflow.

## Interpretation cautions
- A category's assigned-vs-spent gap within a month is usually a timing signal, not a discipline failure — bills land unevenly.
- 'Inflow: Ready to Assign' is the income category; transfers between accounts are not income or spending.
- list_scheduled_transactions only shows manually-created recurrences; use detect_recurring_charges for real recurring spend.`;

const YNAB_WRITE_SAFETY_TEXT = `# Write Safety Rules for this server

- Write tools exist only when the server starts with YNAB_ALLOW_WRITES=1; destructive/bulk tools additionally require confirmed:true after explicit user confirmation.
- Never batch-approve on vague instructions ("approve the rest"). List the exact transactions (payee, amount, category), get explicit confirmation, and state what you are NOT approving.
- Never fabricate transaction IDs. Extract them from review_unapproved / get_transactions results. A batch failing with "transaction does not exist in this budget" is the signature of fabricated IDs.
- After combined category+approval writes, check the returned verification block; require verification.failed to be empty. Do not use the approval-queue count as the only success check — approval can succeed while the category write did not persist.
- Recategorizing a transaction does not move budgeted dollars. To true-up the month, also call update_month_category (it sets an absolute value: compute old budgeted − amount and new budgeted + amount).
- Transfers: use the destination account's transfer_payee_id as payeeId; do not invent a "Transfer : ..." payee name.
- Every transaction write is journaled locally; list_undo_history shows the journal and undo_operation reverses a journaled write.`;

const YNAB_AUDIT_PATTERNS_TEXT = `# Common Audit Patterns

- **Refund mirroring**: when a refund lands, categorize it to the same category as the original purchase so the two net out; flag pending returns (e.g. yellow) until the refund arrives.
- **Manual entry for non-imported spend** (checks, P2P apps, cash): create as uncleared with NO importId so the bank's later import matches and promotes it instead of duplicating.
- **Transfer pairs**: each side of a transfer has an independent cleared state. Before deleting an apparent phantom, check the other side and the prior-month cadence. Credit-card payments should be transfers, not categorized spending.
- **Payee disambiguation**: when payee_name is truncated or ambiguous, read import_payee_name_original — the raw bank string encodes the processor (AplPay, SP = Square, TST* = Toast), full merchant name, and city/state.
- **Aggregator payees** (app stores, marketplaces, municipalities) bill many products under one payee; disambiguate by amount or import_payee_name_original before recategorizing.
- **Split needed on an imported transaction**: the API cannot split an existing transaction; use prepare_split_for_matching and approve the match in the YNAB UI.`;

const YNAB_FLAGS_REFERENCE_TEXT = `# review_unapproved flags reference

| Flag | Meaning | Suggested action |
|------|---------|------------------|
| manually_entered | Hand-keyed, not bank-imported | Confirm it's intentional |
| match_broken | Stale matched_transaction_id reference | The transaction itself is fully editable; only the stale link is immutable via API. GET the matched id: not-found = orphan (safe), live = duplicate (keep one). UI cleanup of the link is cosmetic. |
| no_prior_amount_match | First time this amount appeared for this payee | Review before approving |
| category_drift:was_X | Payee previously categorized elsewhere | Surface the drift with prior-category evidence; ask before fixing |
| new_payee | No history for this payee | Confirm payee and category |
| scheduled_transaction_realized | Came from a scheduled entry | Verify amount and category match expectations |

Transactions flagged match_broken, or manually_entered + no_prior_amount_match, should get explicit user sign-off regardless of batch size.`;

const YNAB_RESOURCES = [
  ["methodology", "YNAB methodology primer: the Four Rules, credit card handling, reconciliation, age of money, and amount conventions for this server.", YNAB_METHODOLOGY_TEXT],
  ["write-safety", "Write-safety rules: gating, confirmed:true, batch approval discipline, verification blocks, undo journal.", YNAB_WRITE_SAFETY_TEXT],
  ["audit-patterns", "Common audit patterns: refund mirroring, transfer pairs, manual entry, payee disambiguation via import_payee_name_original, split-via-match.", YNAB_AUDIT_PATTERNS_TEXT],
  ["flags-reference", "Reference table for the flags array returned by review_unapproved, with suggested actions.", YNAB_FLAGS_REFERENCE_TEXT],
];

for (const [slug, description, text] of YNAB_RESOURCES) {
  server.registerResource(
    `ynab-guide-${slug}`,
    `ynab://guide/${slug}`,
    { title: `YNAB guide: ${slug}`, description, mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text }] })
  );
}

function promptText(text) {
  return () => ({ messages: [{ role: "user", content: { type: "text", text } }] });
}

const YNAB_PROMPTS = [
  ["monthly-review", "Guided month-end review: health snapshot, overspending, credit card funding, income vs spending, and next-month planning.",
    `Run a month-end YNAB review using this server's tools, read-only unless I explicitly approve a change:
1. get_budget_health for the snapshot; note anything yellow/red.
2. get_overspent_categories for the current month; propose (do not apply) coverage moves.
3. audit_credit_card_payments; report underfunded cards.
4. get_income_expense_summary for the trailing 3 months; report savings rate vs the 20% guideline.
5. detect_recurring_charges; flag new or grown subscriptions.
6. Summarize in a table (right-align amounts, negatives in parentheses) and list proposed actions for my approval. Perform zero writes.`],
  ["weekly-triage", "Proposal-only weekly review of unapproved transactions with flag analysis; performs zero writes.",
    `Do a weekly YNAB triage. This is PROPOSAL-ONLY: report 'Writes performed: 0' at the end.
1. review_unapproved (use summary:true first; drill in with compact:true if needed).
2. For each flagged transaction, apply the flags-reference guidance (resource ynab://guide/flags-reference).
3. Propose exact categorizations/approvals as a table (payee, amount, current category, proposed category, flags), separating clean rows from rows needing my judgment.
4. Do not call any write tool.`],
  ["categorize-and-approve", "Guarded categorize-then-approve workflow for the unapproved queue, with verification.",
    `Work through my unapproved YNAB transactions with the write-safety rules (resource ynab://guide/write-safety):
1. review_unapproved with compact:true; never fabricate IDs.
2. Propose categories for uncategorized rows using payee history (get_transactions with payeeId) and import_payee_name_original.
3. List the exact rows you intend to change and wait for my confirmation.
4. Apply with update_transactions (categoryId + approved:true in the same entry); check the verification block and stop if verification.failed is non-empty.
5. Report what was changed, what was skipped, and why.`],
  ["subscription-audit", "Find recurring charges, estimate annual cost, and flag candidates to cancel.",
    `Audit my subscriptions:
1. detect_recurring_charges with monthsBack: 12.
2. Cross-check ambiguous rows against payee variants (search_payees) — the same vendor may bill under multiple payee spellings or identities; cancellation on one does not affect the others.
3. Present a table sorted by estimated annual cost with cadence and last-seen date; flag anything unused, duplicated, or grown in price.
4. Read-only: recommend cancellations, do not change the budget.`],
  ["reconcile-account", "Diagnose an account's reconciliation state and list exactly what to check against the bank statement.",
    `Help me reconcile an account:
1. audit_account_reconciliation without accountId to find accounts needing attention.
2. For the account I pick, rerun with accountId for the open-items list.
3. Walk me through comparing each open item to my bank statement; propose update_transaction cleared:'cleared' for confirmed items (with my approval per the write-safety rules).
4. Remind me to finish the reconciliation lock in the YNAB UI — the API cannot do that step.`],
  ["credit-card-audit", "Check that every credit card's payment category is fully funded and propose fixes.",
    `Audit my credit card payment funding:
1. audit_credit_card_payments.
2. For each underfunded card, explain the shortfall and propose the update_month_category assignment that fixes it (show the math; treat sub-dollar same-day differences as timing).
3. Apply fixes only after my explicit confirmation.`],
];

for (const [slug, description, text] of YNAB_PROMPTS) {
  server.registerPrompt(slug, { title: slug.replace(/-/g, " "), description }, promptText(text));
}

return {
  server,
  internals: {
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
    readUndoJournal,
    undoJournalPath,
    ynabRequestsRemaining,
    currentBudgetMonth,
  },
};

}

// --- Default stdio instance ---
// Identical behavior to the pre-factory single-instance server: credentials,
// budget, and write gating come from the Node config resolution above, and
// the undo journal is the local ~/.ynab-mcp-undo.json file.

const defaultInstance = createYnabServer({
  getAccessToken: async () => API_TOKEN || null,
  hasCredentials: !!API_TOKEN,
  defaultBudgetId: DEFAULT_BUDGET_ID,
  writesEnabled: runtimeConfig.values.YNAB_ALLOW_WRITES?.value === "1",
  journal: IS_CLOUDFLARE_WORKERS ? null : createFsJournal(undoJournalPath()),
  runtime: {
    tokenSource: runtimeConfig.tokenSource,
    detected_agent: runtimeConfig.detected_agent,
    config_fallback_disabled: runtimeConfig.config_fallback_disabled,
    sources_checked: runtimeConfig.sources_checked,
    values: runtimeConfig.values,
    tokenLookupError: tokenLookupError,
  },
});

const server = defaultInstance.server;

// --- Exports (unit tests) ---
// Re-export the default instance's internals under the pre-factory names so
// test/unit.test.mjs and downstream importers work unchanged.

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
  ynabRequestsRemaining,
  currentBudgetMonth,
} = defaultInstance.internals;

export {
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
  readUndoJournal,
  undoJournalPath,
  ynabRequestsRemaining,
  currentBudgetMonth,
  createFsJournal,
};

// --- Start ---
// In Cloudflare Workers there is no stdio to bind and process-level handlers
// are meaningless; the Worker consumer calls createYnabServer itself.

if (!IS_CLOUDFLARE_WORKERS) {
  process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", sanitizeErrorMessage(err?.stack || err));
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", sanitizeErrorMessage(reason?.stack || reason));
    process.exit(1);
  });

  // YNAB_MCP_NO_AUTOSTART=1 lets tests import this module for its exported
  // helpers without binding an MCP server to stdio.
  if (process.env.YNAB_MCP_NO_AUTOSTART !== "1") {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}