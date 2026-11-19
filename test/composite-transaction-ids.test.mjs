import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpHarness, assertToolOk } from "./support/mcp-harness.mjs";

// Each realized occurrence of a scheduled transaction has its own id,
// uuid_YYYY-MM-DD, and YNAB serves it under that full id.
const scheduledRow = (id, date, amount) => ({ id, date, amount, account_id: "fake-checking", payee_id: "fake-market", category_id: "fake-food", approved: true, cleared: "cleared", deleted: false, memo: null, subtransactions: [], _knowledge: 1 });

test("occurrences of one scheduled transaction (uuid_YYYY-MM-DD) are distinct rows in a batch", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const rows = harness.fake.budget().transactions;
  rows.push(scheduledRow("fake-sched_2019-02-15", "2019-02-15", -1000));
  rows.push(scheduledRow("fake-sched_2019-03-15", "2019-03-15", -2000));

  const result = await harness.write("update_transactions", {
    transactions: [{ id: "fake-sched_2019-02-15", cleared: "reconciled" }, { id: "fake-sched_2019-03-15", cleared: "reconciled" }],
    returnSummary: true,
  });
  const data = assertToolOk(result);
  assert.equal(data.verification.failed, 0);
  assert.deepEqual(rows.filter((r) => r.id.startsWith("fake-sched_")).map((r) => r.cleared), ["reconciled", "reconciled"]);
  assert.ok(!harness.fake.requests.some((r) => r.method === "GET" && r.path.endsWith("/transactions/fake-sched")),
    "occurrences must be fetched by their full id, not the stripped base id");
});

test("get_transaction reads a realized scheduled occurrence by its full composite id", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  harness.fake.budget().transactions.push(scheduledRow("fake-sched_2019-04-15", "2019-04-15", -3000));
  const data = assertToolOk(await harness.call("get_transaction", { transactionId: "fake-sched_2019-04-15" }));
  assert.equal(data.id, "fake-sched_2019-04-15");
  assert.equal(data.amount, -3);
});
