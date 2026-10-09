# Synthetic MCP and HTTP safety harness

`test/support/mcp-harness.mjs` connects the actual MCP SDK client and the shared `createYnabServer` through linked MCP transports. Calls go through input validation, registered handlers, the production secure-fetch token/URL checks, a real loopback HTTP server, and a temporary filesystem journal. The injected `fetchImpl` redirects only `https://api.ynab.com/v1/...` to that test server. Tests never configure a production YNAB endpoint or load agent credentials.

`test/support/fake-ynab.mjs` stores independent fake tenants and budgets, transactions, imported IDs, splits, categories, monthly allocations, payees, accounts, schedules, delta revisions and deletion tombstones. Its mutation log records the fake tenant, request body and whether a change was applied. It does not record authorization headers. Every token, name and amount is synthetic.

Run the focused integration tests and scripted agent fixtures with Node 20 or later after `npm ci`:

```sh
node --test test/integration-mcp-http.test.mjs
node scripts/eval-agent-fixtures.mjs
```

The integration tests cover tenant-separated reads, explicit old-history retrieval, imported split linkage, import deduplication, read retries, previews with no writes, separate explicit confirmation, stale state with unchanged row counts, altered requested values, budget/session boundaries, token expiry and single use, verified journal state, undo conflicts, partial batch failures, explained category suggestions and malicious memo instructions. A write can be applied before an injected timeout or response-body disconnect; the test checks persisted state and the HTTP write count to prove the server did not blindly replay it. Persistence drift can return a successful original response while storing dropped or misassigned split lines, or emulate an external edit before a creation's first readback. Tests require verification failure and prevent conflicting deletion undo. Existing split structures are recorded for audit because YNAB does not support an automatic reversal into the original nonsplit structure.

The fake server binds a temporary port on `127.0.0.1`. Environments that prohibit listening sockets need permission for that local test operation. Test cleanup closes only its own MCP transports and fake HTTP connections and removes only its own temporary journal directory.

`test/fixtures/agent-safety.json` contains user requests, adversarial financial text, explicit synthetic approvals, expected state and deterministic tool trajectories. `scripts/eval-agent-fixtures.mjs` replays those trajectories through the same MCP-to-HTTP path, checks tool errors, mutation counts and durable journal entries, and returns a failing exit status if an assertion fails. A fixture cannot set `confirmed:true` unless it declares approval from its synthetic user. No model provider is contacted or billed.

These fixtures evaluate protocol behavior and scripted agent decisions. They do not establish that an arbitrary language model will resist every prompt injection. They also do not reproduce all YNAB internals, transfer side effects, import matching behavior, financial calculations or infrastructure outages. A successful fresh-state check still cannot prevent an external API writer racing the final read and write; YNAB does not provide conditional writes or an atomic multistep commit.
