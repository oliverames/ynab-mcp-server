# Contributing

Bug reports and focused pull requests are welcome. Please open an issue before starting a large change so we can agree on the scope and avoid duplicate work.

## Local checks

Use Node.js 18 or newer, then install the locked dependencies and run the same checks as CI:

```bash
npm ci --no-audit --no-fund
npm run test:unit
npm run test:safety
npm run release:check
YNAB_DISABLE_AGENT_CONFIG_FALLBACK=1 npm run smoke:list-tools
```

The live integration suite writes temporary records to a real YNAB budget. Use a dedicated test budget when you need live coverage. Leave `YNAB_RUN_NONREVERSIBLE_TESTS` unset unless you intend to create category records that the API cannot delete.

## Pull requests

- Keep the server read-only by default.
- Preserve confirmation and expected-count checks for destructive or bulk writes.
- Never commit YNAB tokens, budget exports, transaction details, or local credential files.
- Add or update offline tests for behavior changes.
- Update the README and plugin metadata when a user-facing interface changes.
- Keep each pull request to one clear concern.

By contributing, you agree that your work may be distributed under the repository's MIT License.
