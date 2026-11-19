import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMcpHarness, assertToolOk } from "./support/mcp-harness.mjs";

test("transactionsFile contents are bound into the preview; editing the file after approval is rejected", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ynab-synthetic-txfile-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "batch.json");
  writeFileSync(file, JSON.stringify([{ id: "fake-import", cleared: "reconciled" }]));
  const harness = await createMcpHarness({ localFiles: true }); t.after(() => harness.close());

  const { data: plan, previewToken } = await harness.preview("update_transactions", { transactionsFile: file });
  assert.ok(JSON.stringify(plan).includes("fake-import"), "preview must show the file's rows");

  writeFileSync(file, JSON.stringify([{ id: "fake-uncertain", cleared: "reconciled" }]));
  const stale = await harness.call("update_transactions", { transactionsFile: file, previewToken, confirmed: true });
  assert.equal(stale.isError, true);
  assert.match(stale.content[0].text, /Stale preview/);
  assert.equal(harness.fake.writes().length, 0);

  const fresh = await harness.write("update_transactions", { transactionsFile: file, returnSummary: true });
  assertToolOk(fresh);
  assert.equal(harness.fake.budget().transactions.find((row) => row.id === "fake-uncertain").cleared, "reconciled");
  assert.equal(harness.fake.budget().transactions.find((row) => row.id === "fake-import").cleared, "cleared");
});

test("transactionsFile is unavailable unless the server enables local files", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ynab-synthetic-txfile-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "batch.json");
  writeFileSync(file, JSON.stringify([{ id: "fake-import", cleared: "reconciled" }]));
  const harness = await createMcpHarness(); t.after(() => harness.close());

  const { tools } = await harness.client.listTools();
  const schema = tools.find((tool) => tool.name === "update_transactions").inputSchema;
  assert.equal(schema.properties.transactionsFile, undefined);
  const result = await harness.client.callTool({ name: "preview_write_tool", arguments: { tool_name: "update_transactions", input: { transactionsFile: file } } });
  assert.equal(result.isError, true);
  assert.equal(harness.fake.writes().length, 0);
});

process.env.YNAB_MCP_NO_AUTOSTART = "1";
const { readTransactionsFile } = await import("../index.js");

test("readTransactionsFile validates path, JSON and schema without echoing contents", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ynab-synthetic-txfile-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify([{ id: "t1", cleared: "reconciled" }]));
  assert.deepEqual(readTransactionsFile(good), [{ id: "t1", cleared: "reconciled" }]);

  assert.throws(() => readTransactionsFile("relative.json"), /absolute path to a \.json file/);
  assert.throws(() => readTransactionsFile(join(dir, "x.txt")), /absolute path to a \.json file/);
  assert.throws(() => readTransactionsFile(join(dir, "missing.json")), /Could not read transactionsFile/);
  const secret = join(dir, "bad.json");
  writeFileSync(secret, "SYNTHETIC-SECRET not json");
  assert.throws(() => readTransactionsFile(secret), (err) => /is not valid JSON/.test(err.message) && !err.message.includes("SYNTHETIC-SECRET"));
  const shape = join(dir, "shape.json");
  writeFileSync(shape, JSON.stringify([{ id: "t1", cleared: "done" }]));
  assert.throws(() => readTransactionsFile(shape), /failed validation: 0\.cleared/);
  const empty = join(dir, "empty.json");
  writeFileSync(empty, "[]");
  assert.throws(() => readTransactionsFile(empty), /failed validation/);
});
