#!/usr/bin/env node

import { parseSmokeOptions, parseTextToolResult, withSmokeClient } from "./lib/smoke-client.mjs";
import { createApprovedToolCall } from "./lib/approved-tool-call.mjs";

const options = parseSmokeOptions();

if (process.env.YNAB_ALLOW_WRITES !== "1") {
  throw new Error("smoke:batch-verify creates, updates, and deletes a transaction. Re-run with YNAB_ALLOW_WRITES=1.");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

await withSmokeClient(options, async (client, params) => {
  const approvedToolCall = createApprovedToolCall(client);
  async function call(name, args = {}) {
    const result = await approvedToolCall(name, args);
    if (result.isError) throw new Error(result.content?.[0]?.text || `${name} returned an MCP error`);
    return parseTextToolResult(result);
  }
  let transactionId;

  try {
    const review = await call("review_unapproved", { summary: true });

    const accounts = await call("list_accounts");
    const account = accounts.find((item) => !item.closed && !item.deleted);
    if (!account) throw new Error("No active account found for smoke transaction");

    const categoryGroups = await call("list_categories");
    const category = categoryGroups
      .filter((group) => !group.hidden && !group.deleted && group.name !== "Internal Master Category")
      .flatMap((group) => group.categories)
      .find((item) => !item.hidden && !item.deleted);
    if (!category) throw new Error("No active category found for smoke transaction");

    const created = await call("create_transaction", {
      accountId: account.id,
      date: today(),
      amount: -4.56,
      payeeName: "MCP Batch Verify Smoke",
      memo: "MCP smoke test - safe to delete",
      approved: false,
    });
    transactionId = created.id;

    const updated = await call("update_transactions", {
      transactions: [{
        id: transactionId,
        categoryId: category.id,
        approved: true,
      }],
    });

    if (updated.verification?.checked !== 1) {
      throw new Error(`Expected one verified update, got ${updated.verification?.checked}`);
    }
    if (updated.verification.failed?.length) {
      throw new Error(`Verification failed: ${JSON.stringify(updated.verification.failed)}`);
    }

    const refetched = await call("get_transaction", { transactionId });
    if (refetched.approved !== true) throw new Error("Approval did not persist");
    if (refetched.category_id !== category.id) {
      throw new Error(`Category did not persist: ${refetched.category_id}`);
    }

    console.log(`Connected to ${params.label}`);
    console.log(`review_unapproved summary total: ${review.total}`);
    console.log("Batch category+approval update verified by post-write refetch");
    console.log(`Verification checked: ${updated.verification.checked}`);
    console.log(`Verification retried: ${updated.verification.retried.length}`);
  } finally {
    if (transactionId) {
      await call("delete_transaction", { transactionId, confirmed: true });
    }
  }
});
