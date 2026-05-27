#!/usr/bin/env node

import { parseSmokeOptions, withSmokeClient } from "./lib/smoke-client.mjs";

const requiredTools = [
  "review_unapproved",
  "get_transactions",
  "update_transactions",
  "search_categories",
  "search_payees",
];

const options = parseSmokeOptions();

await withSmokeClient(options, async (client, params) => {
  const result = await client.listTools();
  const toolNames = result.tools.map((tool) => tool.name).sort();
  const missing = requiredTools.filter((name) => !toolNames.includes(name));

  if (missing.length > 0) {
    throw new Error(`Missing expected YNAB tools: ${missing.join(", ")}`);
  }

  console.log(`Connected to ${params.label}`);
  console.log(`Listed ${toolNames.length} tools`);
  console.log(`Required tools present: ${requiredTools.join(", ")}`);
});
