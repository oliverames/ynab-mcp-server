// Regression fixtures for independently reviewed undo safety findings.
// Every financial row, token and HTTP request here is synthetic and loopback-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMcpHarness, assertToolOk, toolData } from "./support/mcp-harness.mjs";
import { FakeYnabHttpServer } from "./support/fake-ynab.mjs";

async function sharedHarnesses(t, secondToken = "fake-token-a") {
  const fake = await new FakeYnabHttpServer().start(); t.after(() => fake.close());
  const directory = await mkdtemp(join(tmpdir(), "ynab-synthetic-undo-safety-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, "journal.json");
  const first = await createMcpHarness({ fake, journalPath, sessionId: "fake-undo-session-one" });
  const second = await createMcpHarness({ fake, journalPath, token: secondToken, sessionId: "fake-undo-session-two" });
  t.after(() => first.close()); t.after(() => second.close());
  return { fake, first, second };
}

async function deleteFixture(harness) {
  assertToolOk(await harness.write("delete_transaction", { transactionId: "fake-import" }));
  const entry = (await harness.journal.read()).find((row) => row.tool === "delete_transaction");
  assert.ok(entry?.undoable);
  assert.equal(entry.undo.type, "recreate_transaction");
  return entry;
}

test("undo detects later flag edits and refuses to overwrite them", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.mutateTransaction("fake-import", { flag_color: "green" });
  assertToolOk(await harness.write("update_transaction", { transactionId: "fake-import", flagColor: "blue" }));
  const entry = (await harness.journal.read()).find((row) => row.tool === "update_transaction");
  assert.equal(entry.verified_after[0].snapshot.flag_color, "blue");
  harness.fake.mutateTransaction("fake-import", { flag_color: "red" });
  const writesBefore = harness.fake.writes().length;
  const preview = await harness.call("preview_write_tool", { tool_name: "undo_operation", input: { entryId: entry.id } });
  assert.equal(preview.isError, true);
  assert.match(String(toolData(preview)), /undo conflict|changed/i);
  assert.equal(harness.fake.writes().length, writesBefore);
  assert.equal(harness.fake.budget().transactions.find((row) => row.id === "fake-import").flag_color, "red");
});

test("undo snapshot also binds deletion state", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  assertToolOk(await harness.write("update_transaction", { transactionId: "fake-import", memo: "Synthetic edited memo" }));
  const entry = (await harness.journal.read()).find((row) => row.tool === "update_transaction");
  assert.equal(entry.verified_after[0].snapshot.deleted, false);
  harness.fake.mutateTransaction("fake-import", { deleted: true });
  const writesBefore = harness.fake.writes().length;
  const preview = await harness.call("preview_write_tool", { tool_name: "undo_operation", input: { entryId: entry.id } });
  assert.equal(preview.isError, true);
  assert.equal(harness.fake.writes().length, writesBefore);
});

test("shared-file undo history hides other tenants before applying the display limit", async (t) => {
  const { fake, first, second } = await sharedHarnesses(t, "fake-token-b");
  assertToolOk(await first.write("update_transaction", { transactionId: "fake-import", memo: "Synthetic tenant A private memo" }));
  const firstEntry = (await first.journal.read()).find((row) => row.tenant_id === "fake-tenant-a");
  assertToolOk(await second.write("update_transaction", { transactionId: "fake-import", memo: "Synthetic tenant B private memo" }));
  const secondEntry = (await second.journal.read()).find((row) => row.tenant_id === "fake-tenant-b");
  const firstHistory = assertToolOk(await first.call("list_undo_history", { limit: 1 }));
  const secondHistory = assertToolOk(await second.call("list_undo_history", { limit: 1 }));
  assert.equal(firstHistory.entries.length, 1);
  assert.equal(firstHistory.entries[0].id, firstEntry.id);
  assert.equal(secondHistory.entries.length, 1);
  assert.equal(secondHistory.entries[0].id, secondEntry.id);
  assert.ok(!firstHistory.entries.some((row) => row.id === secondEntry.id));
  const foreign = await first.call("preview_write_tool", { tool_name: "undo_operation", input: { entryId: secondEntry.id } });
  assert.equal(foreign.isError, true);
  assert.equal(fake.writes().length, 2);
});

test("applied but lost recreation response blocks every automatic undo retry after reconnect", async (t) => {
  const { fake, first, second } = await sharedHarnesses(t);
  const entry = await deleteFixture(first);
  const args = { entryId: entry.id };
  const { previewToken } = await first.preview("undo_operation", args);
  fake.injectFault({ method: "POST", path: "/transactions", afterApply: true, mode: "body-disconnect" });
  const result = await first.call("undo_operation", { ...args, previewToken, confirmed: true });
  assert.equal(result.isError, true);
  const posts = () => fake.writes().filter((row) => row.method === "POST" && row.path.endsWith("/transactions"));
  assert.equal(posts().length, 1);
  assert.equal(fake.budget().transactions.filter((row) => row.id.startsWith("fake-created-") && !row.deleted).length, 1);
  assert.equal((await first.journal.read()).find((row) => row.id === entry.id).undo_status, "submitted");
  for (const harness of [first, second]) {
    const retriedPreview = await harness.call("preview_write_tool", { tool_name: "undo_operation", input: args });
    assert.equal(retriedPreview.isError, true);
    assert.match(String(toolData(retriedPreview)), /previous undo|uncertain|unresolved|automatic retry|inspect fresh state/i);
  }
  const history = assertToolOk(await second.call("list_undo_history"));
  const pending = history.entries.find((row) => row.id === entry.id);
  assert.equal(pending.undo_status, "submitted");
  assert.equal(posts().length, 1);
});

test("two MCP sessions atomically claim the same undo and send exactly one recreation POST", async (t) => {
  const { fake, first, second } = await sharedHarnesses(t);
  const entry = await deleteFixture(first);
  const args = { entryId: entry.id };
  const firstPreview = await first.preview("undo_operation", args);
  const secondPreview = await second.preview("undo_operation", args);
  assert.equal(fake.writes().filter((row) => row.method === "POST").length, 0);
  const results = await Promise.all([
    first.call("undo_operation", { ...args, previewToken: firstPreview.previewToken, confirmed: true }),
    second.call("undo_operation", { ...args, previewToken: secondPreview.previewToken, confirmed: true }),
  ]);
  assert.equal(results.filter((result) => !result.isError).length, 1);
  assert.equal(results.filter((result) => result.isError).length, 1);
  assert.equal(fake.writes().filter((row) => row.method === "POST" && row.path.endsWith("/transactions")).length, 1);
  assert.equal(fake.budget().transactions.filter((row) => row.id.startsWith("fake-created-") && !row.deleted).length, 1);
  const stored = (await first.journal.read()).find((row) => row.id === entry.id);
  assert.equal(stored.undone, true);
  assert.equal(stored.undo_status, "completed");
});

test("undo preview remains read-only and successful undo persists completed status", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  assertToolOk(await harness.write("update_transaction", { transactionId: "fake-import", flagColor: "blue" }));
  const entry = (await harness.journal.read()).find((row) => row.tool === "update_transaction");
  const args = { entryId: entry.id };
  const writesBefore = harness.fake.writes().length;
  const { previewToken } = await harness.preview("undo_operation", args);
  assert.equal((await harness.journal.read()).find((row) => row.id === entry.id).undo_status, undefined);
  assert.equal(harness.fake.writes().length, writesBefore);
  assertToolOk(await harness.call("undo_operation", { ...args, previewToken, confirmed: true }));
  assert.equal(harness.fake.budget().transactions.find((row) => row.id === "fake-import").flag_color, null);
  assert.equal((await harness.journal.read()).find((row) => row.id === entry.id).undo_status, "completed");
});
