import { test } from "node:test";
import assert from "node:assert/strict";
import { createMcpHarness, assertToolOk } from "./support/mcp-harness.mjs";

// Rows older than the 90-day verification window used to cost one GET each,
// before the write (undo snapshot) and after it (verification).
const perRowGets = (fake, id) => fake.requests.filter((r) => r.method === "GET" && r.path.endsWith(`/transactions/${id}`)).length;
const accountListAt = (fake, sinceDate) => fake.requests.some((r) => r.method === "GET" && r.path.endsWith("/accounts/fake-checking/transactions") && r.query.since_date === sinceDate);

test("post-write verification of an old row refetches its account and date range, not the row", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const data = assertToolOk(await harness.write("update_transactions", {
    transactions: [{ id: "fake-old", cleared: "reconciled" }],
    returnSummary: true,
  }));
  assert.equal(data.verification.failed, 0);
  const patchAt = harness.fake.requests.findIndex((r) => r.method === "PATCH");
  const afterPatch = harness.fake.requests.slice(patchAt + 1);
  assert.deepEqual(afterPatch.map((r) => [r.method, r.path.replace(/^.*\/plans\/[^/]+/, ""), r.query.since_date, r.query.until_date]),
    [["GET", "/accounts/fake-checking/transactions", "2019-01-10", "2019-01-10"]],
    "verification should be one list request bounded by the PATCH response's account and date");
});

test("reconciling an old row with scope uses account-scoped lists, not per-row GETs", async (t) => {
  const harness = await createMcpHarness(); t.after(() => harness.close());
  const data = assertToolOk(await harness.write("update_transactions", {
    transactions: [{ id: "fake-old", cleared: "reconciled" }],
    scope: { accountId: "fake-checking", sinceDate: "2019-01-01", untilDate: "2019-12-31" },
    returnSummary: true,
  }));
  assert.equal(data.verification.failed, 0);
  assert.equal(perRowGets(harness.fake, "fake-old"), 0);
  assert.ok(accountListAt(harness.fake, "2019-01-01"), "pre-write snapshot should use the scope hint");
  assert.equal(harness.fake.budget().transactions.find((row) => row.id === "fake-old").cleared, "reconciled");
});

process.env.YNAB_MCP_NO_AUTOSTART = "1";
const { accountDateScopes } = await import("../index.js");

test("accountDateScopes groups rows by account with min/max dates", () => {
  assert.deepEqual(
    accountDateScopes([
      { account_id: "a", date: "2025-06-10" },
      { account_id: "b", date: "2025-01-01" },
      { account_id: "a", date: "2025-05-09" },
      { account_id: "a", date: "2025-08-18" },
      { date: "2025-01-01" },
    ]),
    [
      { accountId: "a", sinceDate: "2025-05-09", untilDate: "2025-08-18" },
      { accountId: "b", sinceDate: "2025-01-01", untilDate: "2025-01-01" },
    ],
  );
});
