// Optional Sentry error reporting for the stdio server.
//
// Reporting is off unless SENTRY_DSN is set, and it never runs inside the
// Cloudflare Worker that imports index.js. @sentry/node is loaded with a
// non-literal dynamic import so bundlers (wrangler/esbuild) leave it out of
// the Worker bundle and stdio users without a DSN never load it at all.
//
// Financial data must never reach Sentry. Tool arguments, YNAB response
// bodies, payee names, amounts, and memos can all surface in error messages,
// so every event is reduced to an error type, a fixed message, stack frames,
// and a short allowlist of tags. Breadcrumbs, request data, user data, and
// extra context are dropped.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SENTRY_MODULE = "@sentry/node";
const IS_CLOUDFLARE_WORKERS = globalThis.navigator?.userAgent === "Cloudflare-Workers";

export const SCRUBBED_MESSAGE = "Error details withheld to protect financial data.";
export const YNAB_SCRUBBED_MESSAGE = "YNAB API request failed; response details withheld.";

const SAFE_TAG_KEYS = new Set(["tool", "source", "ynab_error_id", "ynab_error_name", "http_status"]);
const SAFE_CONTEXT_KEYS = new Set(["runtime", "os"]);
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_$.]{0,63}$/;
const SAFE_TAG_VALUE = /^[A-Za-z0-9_.:-]{1,64}$/;

let sentry = null;

// Resolved lazily: the Worker bundle imports this module, and its
// import.meta.url is not a file URL there.
let packageRoot;
function getPackageRoot() {
  if (packageRoot === undefined) {
    try {
      packageRoot = fileURLToPath(new URL("../", import.meta.url));
    } catch {
      packageRoot = null;
    }
  }
  return packageRoot;
}

// Absolute paths name the local user's home directory; keep only the part
// inside this package or a dependency.
function relativeFramePath(file) {
  if (typeof file === "string" && file.startsWith("file://")) file = file.slice("file://".length);
  if (typeof file !== "string" || !file.startsWith("/")) return file;
  const root = getPackageRoot();
  if (root && file.startsWith(root)) return `app:///${file.slice(root.length)}`;
  const nodeModules = file.lastIndexOf("/node_modules/");
  if (nodeModules !== -1) return `app:///${file.slice(nodeModules + 1)}`;
  return file.slice(file.lastIndexOf("/") + 1);
}

export function errorReportingEnabled() {
  return sentry !== null;
}

function packageRelease() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    // Sentry rejects release names containing "/", so drop the npm scope.
    return `${pkg.name.replace(/^@[^/]+\//, "")}@${pkg.version}`;
  } catch {
    return undefined;
  }
}

export async function initErrorReporting(env = process.env) {
  if (IS_CLOUDFLARE_WORKERS || sentry) return errorReportingEnabled();
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  try {
    const Sentry = await import(SENTRY_MODULE);
    Sentry.init({
      dsn,
      release: packageRelease(),
      sendDefaultPii: false,
      tracesSampleRate: 0,
      // Default integrations include HTTP, console, and context capture that
      // could carry request bodies or financial strings; enable only the
      // ones that read nothing but the error object itself.
      defaultIntegrations: false,
      integrations: [Sentry.dedupeIntegration(), Sentry.linkedErrorsIntegration()],
      initialScope: { contexts: { runtime: { name: "node", version: process.version } } },
      maxBreadcrumbs: 0,
      beforeBreadcrumb: () => null,
      beforeSend: scrubEvent,
    });
    sentry = Sentry;
    return true;
  } catch (error) {
    console.error(`Sentry error reporting disabled: ${error?.name || "Error"} while loading ${SENTRY_MODULE}.`);
    return false;
  }
}

// YNAB SDK and fetch failures arrive as plain objects or Errors carrying a
// YNAB error envelope ({ error: { id, name, detail } }). id and name are
// fixed YNAB enums; detail and messages can echo user data and are dropped.
function ynabErrorTags(error) {
  const envelope = error?.error && typeof error.error === "object" ? error.error : null;
  if (!envelope) return null;
  const tags = { source: "ynab_api" };
  if (typeof envelope.id === "string" && /^\d{3}(\.\d{1,3})?$/.test(envelope.id)) {
    tags.ynab_error_id = envelope.id;
    tags.http_status = envelope.id.slice(0, 3);
  }
  if (typeof envelope.name === "string" && /^[a-z_]{1,64}$/.test(envelope.name)) {
    tags.ynab_error_name = envelope.name;
  }
  return tags;
}

// Build a replacement Error that keeps only the original type and stack
// frames. The first stack line (which repeats the message) is rewritten.
export function sanitizeError(error, message = SCRUBBED_MESSAGE, stackStart = sanitizeError) {
  const rawName = error instanceof Error ? error.name : error?.error ? "YnabApiError" : typeof error;
  const name = SAFE_ERROR_NAME.test(String(rawName)) ? String(rawName) : "Error";
  const safe = new Error(message);
  safe.name = name;
  // Non-Error throws (YNAB SDK error envelopes) have no stack of their own;
  // point the replacement's stack at the caller instead of this module.
  Error.captureStackTrace?.(safe, stackStart);
  const frames = typeof error?.stack === "string"
    ? error.stack.split("\n").filter((line) => /^\s+at\s/.test(line))
    : [];
  safe.stack = [`${name}: ${message}`, ...(frames.length ? frames : (safe.stack ?? "").split("\n").slice(1))].join("\n");
  return safe;
}

export function captureToolError(toolName, error) {
  if (!sentry) return;
  const ynabTags = ynabErrorTags(error);
  const safe = sanitizeError(error, ynabTags ? YNAB_SCRUBBED_MESSAGE : SCRUBBED_MESSAGE, captureToolError);
  const tool = typeof toolName === "string" && SAFE_TAG_VALUE.test(toolName) ? toolName : "unknown";
  sentry.captureException(safe, {
    tags: { tool, source: "tool_handler", ...(ynabTags ?? {}) },
    fingerprint: ["tool-error", tool, safe.name, ynabTags?.ynab_error_id ?? "-"],
  });
}

export function captureFatalError(kind, error) {
  if (!sentry) return;
  const safe = sanitizeError(error, SCRUBBED_MESSAGE, captureFatalError);
  sentry.captureException(safe, {
    tags: { source: kind === "unhandledRejection" ? "unhandled_rejection" : "uncaught_exception" },
    level: "fatal",
  });
}

export async function flushErrorReporting(timeoutMs = 2000) {
  if (!sentry) return true;
  try {
    return await sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

// Defense in depth: every outgoing event passes through here even when it
// was built by captureToolError, so anything that bypasses the sanitizer
// (or a future SDK default) is still reduced to the safe shape.
export function scrubEvent(event) {
  if (!event || typeof event !== "object") return event;
  delete event.request;
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  delete event.server_name;
  delete event.modules;
  delete event.logentry;
  if (event.message !== undefined) event.message = SCRUBBED_MESSAGE;
  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (!SAFE_CONTEXT_KEYS.has(key)) delete event.contexts[key];
    }
  }
  if (event.tags) {
    for (const [key, value] of Object.entries(event.tags)) {
      if (!SAFE_TAG_KEYS.has(key) || !SAFE_TAG_VALUE.test(String(value))) delete event.tags[key];
    }
  }
  for (const value of event.exception?.values ?? []) {
    const type = SAFE_ERROR_NAME.test(String(value.type ?? "")) ? value.type : "Error";
    value.type = type;
    if (value.value !== YNAB_SCRUBBED_MESSAGE) value.value = SCRUBBED_MESSAGE;
    if (value.mechanism) delete value.mechanism.data;
    for (const frame of value.stacktrace?.frames ?? []) {
      delete frame.vars;
      delete frame.pre_context;
      delete frame.context_line;
      delete frame.post_context;
      if (frame.filename) frame.filename = relativeFramePath(frame.filename);
      if (frame.abs_path) frame.abs_path = relativeFramePath(frame.abs_path);
    }
  }
  return event;
}
