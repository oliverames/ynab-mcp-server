#!/usr/bin/env node

import { parseSmokeOptions, parseTextToolResult, withSmokeClient } from "./lib/smoke-client.mjs";

const options = parseSmokeOptions();

await withSmokeClient(options, async (client, params) => {
  const result = await client.callTool({
    name: "review_unapproved",
    arguments: { summary: true },
  });

  if (result.isError) {
    throw new Error(result.content?.[0]?.text || "review_unapproved returned an MCP error");
  }

  const payload = parseTextToolResult(result);
  if (typeof payload.total !== "number") {
    throw new Error("review_unapproved summary did not include a numeric total");
  }

  console.log(`Connected to ${params.label}`);
  console.log("Called review_unapproved with summary: true");
  console.log(`Total unapproved: ${payload.total}`);
  console.log(`Ready to approve: ${payload.ready_to_approve?.count ?? 0}`);
  console.log(`Needs category first: ${payload.needs_category_first?.count ?? 0}`);
});
