# Worklog

## 2026-04-09 — v1.3.0: Generalize for public use, migrate to registerTool, add create_payee

**What changed**: Overhauled the server for general public distribution. Made the 1Password fallback configurable via `YNAB_OP_PATH` env var (previously hardcoded to `op://Development/YNAB API Token/credential`). Migrated all 43 `server.tool()` calls to `server.registerTool()` — the new non-deprecated API that supports `outputSchema` and future MCP features. Added `create_payee` tool to cover `POST /budgets/:id/payees` from YNAB API v1.82 (was missing from the v1.79 local spec). Updated local OpenAPI spec to v1.82 from live api.ynab.com. Code quality: extracted `mapTransactionUpdate()` helper (removed duplication between `update_transaction` and `update_transactions`), single-pass partition in `review_unapproved`, simplified `resolveBudgetId`. Published as 1.3.0.

**Decisions made**: Made `YNAB_OP_PATH` opt-in (1Password fallback only activates if the env var is set) rather than keeping a hardcoded default path — this avoids confusing errors for users who don't use 1Password. Bumped to 1.3.0 (minor) rather than patch because `create_payee` is a new tool and the `registerTool` migration changes the observable MCP protocol metadata shape. Left `server.tool` comment ("frozen as of protocol version 2025-03-26") in the SDK as justification for the migration. Did not migrate `test.js` category/date fixes since they were already in HEAD.

**Left off at**: Published 1.3.0 to npm and pushed. Server is at 100% YNAB API v1.82 coverage (44 tools). Next steps if continuing: (1) add a `create_payee` test to test.js, (2) consider adding `outputSchema` to tools now that `registerTool` supports it — would give clients structured data access. Still open: 1Password items for Meta, Threads, Sprout, UniFi credentials (carried from previous session).

**Open questions**: Should we add `outputSchema` to tool definitions for structured MCP responses? The `registerTool` API supports it but it's extra work per-tool.

---

## 2026-04-06 — 1Password CLI fallback for credential resolution

**What changed**: Added automatic 1Password CLI fallback to credential resolution at startup. When environment variables are not set, the server attempts to resolve them via `op read` from the Development vault before failing. Uses `execFileSync` (Node) or `exec.Command` (Go) for shell-safe execution with a 10s timeout. Silent no-op if 1Password CLI is unavailable. Updated README to document the integration with `op://` reference paths. Part of a broader session that also touched ynab-mcp-server, imagerelay-mcp-server, meta-mcp-server, sprout-mcp-server, and ames-unifi-mcp.

**Decisions made**: Used `execFileSync` instead of `execSync` to avoid shell injection surface (even though inputs are hardcoded string literals). Added the fallback as a separate `op-fallback.ts` module (TS servers) or inline helper (Go) rather than modifying the existing auth flow, keeping the env var path as primary (zero overhead) and 1Password as fallback only. Chose `op://Development/` vault paths matching existing 1Password item names where items exist; for servers without items yet (Meta, Sprout, UniFi), chose conventional names so items can be created later.

**Left off at**: Published and pushed. 1Password items still need to be created for Meta Access Token, Threads Access Token, Sprout API Token/OAuth Client, and UniFi Controller credentials. YNAB and ImageRelay items already exist. Also: 20 uncategorized YNAB transactions from this session's review were identified but not yet categorized.

**Open questions**: None.

---



## 2026-03-22 — v1.2.1: Bug fixes and field coverage audit via Ralph Loop

**What changed**: Used a 9-iteration Ralph Loop to systematically audit the entire MCP server. Fixed `review_unapproved` misclassifying split and transfer transactions. Fixed `update_transactions` snake_case schema inconsistency. Added `.nullable()` to update tool fields that need clearing. Added 14+ missing response fields across all formatters (verified field-by-field against OpenAPI spec v1.79.0). Added `goalTargetDate` to `update_category`. Added subtransactions to bulk `create_transactions`. Reverted an incorrect `importId` addition after the OpenAPI spec proved the SDK types were misleading. Added `default_budget`, `date_format`, `currency_format` to `list_budgets`. Added debt account fields to `formatAccount` with correct milliunits-vs-percentage conversion.

**Decisions made**: Verified against the canonical OpenAPI spec (not just SDK types) after discovering the SDK's `SaveCategory` TypeScript type was missing `goal_target_date` and the `SaveTransaction` type included `import_id` which isn't actually writable on updates. Kept `lastKnowledgeOfServer` out — it's a delta-sync optimization parameter, not a functional gap, and MCP tools are stateless. Passed `debt_interest_rates` raw (percentages) while converting `debt_minimum_payments`/`debt_escrow_amounts` (milliunits) — they have mixed units in the same model.

**Left off at**: Implementation complete, README updated, code simplified. All 43 tests pass. Next step is `npm publish` to push v1.2.1 to npm.

**Open questions**: The `list_budgets` response shape changed from array to object (breaking change) — monitor for downstream issues.

---

## 2026-03-21 — Published v1.2.0 to npm

**What changed**: Published `@oliverames/ynab-mcp-server@1.2.0` to npm. Also published `@oliverames/meta-mcp-server@2.0.0` (new package) and `@oliverames/sprout-mcp-server@1.1.0`.

**Decisions made**: Existing npm auth token couldn't create new scoped packages — needed a granular access token with publish scope.

**Left off at**: All three MCP servers are published and up to date on npm. No further work needed.

**Open questions**: None.

---

## 2026-03-21 — v1.2.0: Full API coverage, marketing README

**What changed**: Added 11 new tools to reach 43 total, covering 100% of YNAB API v1.79.0. Added `ynabFetch` helper for direct HTTP calls to endpoints the ynab SDK doesn't support (category CRUD, money movements). Created marketing-grade README.md. Enhanced existing tools with richer metadata. Fixed version mismatch and misleading descriptions. Added 96 lines of new tests.

**Decisions made**: Used direct `fetch` via `ynabFetch` helper for newer API endpoints (categories, category groups, money movements) since the official ynab npm SDK v2.5.0 doesn't expose these. Kept the SDK for everything it does support. Intentionally omitted delta request support (`last_knowledge_of_server`) since MCP tools are stateless. Skipped deprecated debt fields (`debt_original_balance` etc.) to keep output clean.

**Left off at**: All implementation work is done. Next steps would be publishing v1.2.0 to npm (`npm publish`) and potentially adding the new tool count to the npm package description. Could also consider adding delta request support if users report rate limiting issues.

**Open questions**: Should we add `update_category` support for moving categories between groups (the API supports it but it's a niche operation)? Should we expose `last_knowledge_of_server` for power users who want incremental fetches?

---
