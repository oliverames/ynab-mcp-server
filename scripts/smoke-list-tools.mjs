#!/usr/bin/env node

import { parseSmokeOptions, withSmokeClient } from "./lib/smoke-client.mjs";

const requiredTools = [
  "review_unapproved",
  "get_transactions",
  "search_categories",
  "search_payees",
  "ynab_auth_status",
  "ynab_tool_index",
  "ynab_tool_execute",
];

const options = parseSmokeOptions();
const requiredWriteTools = process.env.YNAB_ALLOW_WRITES === "1"
  ? ["update_transactions", "approve_transactions", "ynab_write_tool_execute"]
  : [];

await withSmokeClient(options, async (client, params) => {
  const result = await client.listTools();
  const toolNames = result.tools.map((tool) => tool.name).sort();
  const expectedTools = [...requiredTools, ...requiredWriteTools];
  const missing = expectedTools.filter((name) => !toolNames.includes(name));

  if (missing.length > 0) {
    throw new Error(`Missing expected YNAB tools: ${missing.join(", ")}`);
  }

  console.log(`Connected to ${params.label}`);
  console.log(`Listed ${toolNames.length} tools`);
  console.log(`Required tools present: ${expectedTools.join(", ")}`);
});
