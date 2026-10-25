#!/usr/bin/env node

// Post-deploy check for the hosted connector. Reuses the one-time consent
// grant stored in 1Password (create it with `npm run smoke:hosted:consent`),
// refreshes it, saves the rotated refresh token back, then asserts the live
// Worker serves this checkout's tools, tool count, version and instructions.
// Read-only: it lists tools and never calls one, so no YNAB request is made.

import { parseHostedArgs, storeForOptions } from "./lib/hosted-cli.mjs";
import { runHostedSmoke } from "./lib/hosted-smoke.mjs";

try {
  const options = parseHostedArgs(process.argv.slice(2), "npm run smoke:hosted --");
  await runHostedSmoke({ store: storeForOptions(options), url: options.url });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
