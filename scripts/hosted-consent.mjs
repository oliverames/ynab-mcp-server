#!/usr/bin/env node

// One-time (about monthly) browser consent for `npm run smoke:hosted`. Registers
// a public OAuth client with the hosted connector, opens its consent page with
// a loopback redirect, and stores the resulting refresh token in 1Password.

import { openInBrowser, parseHostedArgs, storeForOptions } from "./lib/hosted-cli.mjs";
import { runHostedConsent } from "./lib/hosted-smoke.mjs";

try {
  const options = parseHostedArgs(process.argv.slice(2), "npm run smoke:hosted:consent --", { flags: ["--no-open"] });
  await runHostedConsent({
    store: storeForOptions(options),
    url: options.url,
    openBrowser: options.noOpen ? async () => {} : openInBrowser,
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
