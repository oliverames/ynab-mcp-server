// Sentry reporting must never carry financial data. These tests run the real
// @sentry/node client against a loopback DSN and inspect the raw envelopes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
process.env.YNAB_API_TOKEN = "fake-unused-bootstrap-token";
process.env.YNAB_RATE_LIMIT_PER_HOUR = "0";
process.env.YNAB_HTTP_RETRIES = "1";
delete process.env.SENTRY_DSN;
delete process.env.YNAB_API_TOKEN_FILE;
delete process.env.YNAB_OP_PATH;

const reporting = await import("../lib/error-reporting.mjs");
const { createYnabServer } = await import("../index.js");

// Synthetic financial strings that must never appear in an envelope.
const PAYEE = "Synthetic Payee Sentinel";
const MEMO = "synthetic memo sentinel 4417";
const AMOUNT = "123.45";

const envelopes = [];
const sink = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = Buffer.concat(chunks);
    if (request.headers["content-encoding"] === "gzip") body = gunzipSync(body);
    envelopes.push(body.toString("utf8"));
    response.writeHead(200, { "content-type": "application/json" }).end("{}");
  });
});
await new Promise((resolve) => sink.listen(0, "127.0.0.1", resolve));
test.after(() => new Promise((resolve) => sink.close(resolve)));

const enabled = await reporting.initErrorReporting({ SENTRY_DSN: `http://publickey@127.0.0.1:${sink.address().port}/1` });

function eventsFrom(raw) {
  return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((item) => item.exception);
}

test("scrubEvent drops request, user, extra, breadcrumbs, and unsafe tags and contexts", () => {
  const event = reporting.scrubEvent({
    message: `Payment to ${PAYEE}`,
    request: { data: { memo: MEMO } },
    user: { ip_address: "203.0.113.9", email: "someone@example.com" },
    extra: { args: { amount: AMOUNT } },
    breadcrumbs: [{ message: MEMO }],
    server_name: "someones-laptop",
    tags: { tool: "list_accounts", payee: PAYEE, source: `x ${MEMO}` },
    contexts: { runtime: { name: "node" }, app: { memo: MEMO } },
    exception: { values: [{ type: "TypeError", value: `bad ${PAYEE}`, mechanism: { type: "generic", data: { memo: MEMO } }, stacktrace: { frames: [{ filename: "/Users/someone/project/index.js", vars: { memo: MEMO }, context_line: MEMO }] } }] },
  });
  const text = JSON.stringify(event);
  for (const secret of [PAYEE, MEMO, AMOUNT, "203.0.113.9", "someone@example.com", "someones-laptop"]) {
    assert.equal(text.includes(secret), false, `event still contains ${secret}`);
  }
  assert.deepEqual(event.tags, { tool: "list_accounts" });
  assert.deepEqual(Object.keys(event.contexts), ["runtime"]);
  assert.equal(event.exception.values[0].type, "TypeError");
  assert.equal(event.exception.values[0].value, reporting.SCRUBBED_MESSAGE);
});

test("sanitizeError keeps the error type and stack frames but not the message", () => {
  const original = new RangeError(`Amount ${AMOUNT} for ${PAYEE}`);
  const safe = reporting.sanitizeError(original);
  assert.equal(safe.name, "RangeError");
  assert.equal(safe.message, reporting.SCRUBBED_MESSAGE);
  assert.equal(safe.stack.includes(PAYEE), false);
  assert.match(safe.stack, /\n\s+at /);
});

test("frame-shaped lines inside an error message never become stack frames", () => {
  const original = new Error(`lookup failed\n    at /Users/x/secret.js:1:1\n    at ${PAYEE} (${MEMO}:2:3)`);
  const safe = reporting.sanitizeError(original);
  for (const secret of ["/Users/x/secret.js", "secret.js", PAYEE, MEMO]) {
    assert.equal(safe.stack.includes(secret), false, `stack still contains ${secret}`);
  }
  assert.match(safe.stack, /\n\s+at /);

  // scrubEvent drops frames that do not look like code locations, even when
  // a frame-shaped message line reached the SDK's stack parser.
  const event = reporting.scrubEvent({ exception: { values: [{ type: "Error", value: "x", stacktrace: { frames: [
    { filename: "/Users/x/secret.js", function: "?", lineno: 1 },
    { filename: "app:///index.js", function: `${PAYEE} memo`, lineno: 2 },
    { filename: "node:internal/process/task_queues", function: "process.processTicksAndRejections", lineno: 3 },
    { filename: "app:///index.js", function: "run", lineno: 4 },
  ] } }] } });
  const frames = event.exception.values[0].stacktrace.frames;
  assert.deepEqual(frames.map((frame) => frame.function), ["process.processTicksAndRejections", "run"]);
  assert.equal(JSON.stringify(event).includes(PAYEE), false);
});

test("frame paths are package-relative or reduced to a basename on every platform", () => {
  assert.equal(reporting.relativeFramePath("C:\\Users\\someone\\AppData\\npm-cache\\_npx\\abc\\node_modules\\ynab\\dist\\index.js"), "app:///node_modules/ynab/dist/index.js");
  assert.equal(reporting.relativeFramePath("C:\\Users\\someone\\Documents\\budget notes.js"), "budget notes.js");
  assert.equal(reporting.relativeFramePath("\\\\fileserver\\share\\someone\\tool.js"), "tool.js");
  assert.equal(reporting.relativeFramePath("file:///C:/Users/someone/elsewhere/x.mjs"), "x.mjs");
  assert.equal(reporting.relativeFramePath("/home/someone/other-project/y.js"), "y.js");
  assert.equal(reporting.relativeFramePath(new URL("../index.js", import.meta.url).pathname), "app:///index.js");
  assert.equal(reporting.relativeFramePath("node:internal/process/task_queues"), "node:internal/process/task_queues");

  // A Windows path outside the package does not survive as a frame at all.
  const event = reporting.scrubEvent({ exception: { values: [{ type: "Error", value: "x", stacktrace: { frames: [
    { filename: "C:\\Users\\someone\\secret.js", function: "f" },
  ] } }] } });
  assert.deepEqual(event.exception.values[0].stacktrace.frames, []);
});

test("a failed tool call reaches Sentry with its tool name and no financial data", async () => {
  assert.equal(enabled, true, "initErrorReporting did not enable Sentry");
  // A YNAB error response whose detail echoes user data back.
  const fetchImpl = async () => new Response(JSON.stringify({ error: { id: "404.2", name: "resource_not_found", detail: `${PAYEE} ${MEMO} ${AMOUNT}` } }), { status: 404, headers: { "content-type": "application/json" } });
  const instance = createYnabServer({
    getAccessToken: async () => "fake-token-a",
    hasCredentials: true,
    defaultBudgetId: "fake-budget-a",
    fetchImpl,
    runtime: { tokenSource: "synthetic-test" },
    onToolError: reporting.captureToolError,
  });
  const client = new Client({ name: "sentry-scrub-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([instance.server.connect(serverTransport), client.connect(clientTransport)]);

  const result = await client.callTool({ name: "get_payee", arguments: { payeeId: `${PAYEE} ${MEMO}` } });
  assert.equal(result.isError, true);
  assert.equal(await reporting.flushErrorReporting(5000), true);
  await client.close();

  const raw = envelopes.join("\n");
  const events = eventsFrom(raw);
  assert.equal(events.length, 1, raw);
  const [event] = events;
  for (const secret of [PAYEE, MEMO, AMOUNT, "fake-token-a", homedir()]) {
    assert.equal(raw.includes(secret), false, `envelope contains ${secret}`);
  }
  assert.equal(event.tags.tool, "get_payee");
  assert.equal(event.tags.source, "ynab_api");
  assert.equal(event.tags.ynab_error_id, "404.2");
  assert.equal(event.exception.values[0].value, reporting.YNAB_SCRUBBED_MESSAGE);
  assert.equal(event.user, undefined);
  assert.equal(event.request, undefined);
  assert.equal(event.server_name, undefined);
  assert.match(event.release, /^mcp-server-for-ynab@\d+\.\d+\.\d+/);
});
