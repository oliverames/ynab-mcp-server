# Worklog

## 2026-03-22 — v1.2.1: Bug fixes and field coverage audit via Ralph Loop

**What changed**: Used a 9-iteration Ralph Loop to systematically audit the entire MCP server. Fixed `review_unapproved` misclassifying split and transfer transactions. Fixed `update_transactions` snake_case schema inconsistency. Added `.nullable()` to update tool fields that need clearing. Added 14+ missing response fields across all formatters (verified field-by-field against OpenAPI spec v1.79.0). Added `goalTargetDate` to `update_category`. Added subtransactions to bulk `create_transactions`. Reverted an incorrect `importId` addition after the OpenAPI spec proved the SDK types were misleading. Added `default_budget`, `date_format`, `currency_format` to `list_budgets`. Added debt account fields to `formatAccount` with correct milliunits-vs-percentage conversion.

**Decisions made**: Verified against the canonical OpenAPI spec (not just SDK types) after discovering the SDK's `SaveCategory` TypeScript type was missing `goal_target_date` and the `SaveTransaction` type included `import_id` which isn't actually writable on updates. Kept `lastKnowledgeOfServer` out — it's a delta-sync optimization parameter, not a functional gap, and MCP tools are stateless. Passed `debt_interest_rates` raw (percentages) while converting `debt_minimum_payments`/`debt_escrow_amounts` (milliunits) — they have mixed units in the same model.

**Left off at**: Implementation complete, README updated, code simplified. All 43 tests pass. Next step is `npm publish` to push v1.2.1 to npm.

**Open questions**: The `list_budgets` response shape changed from array to object (breaking change) — monitor for downstream issues.

---

## 2026-03-21 — Published v1.2.0 to npm

**What changed**: Published `@oliverames/ynab-mcp-server@1.2.0` to npm. Also published `@oliverames/meta-mcp-server@2.0.0` (new package) and `@oliverames/sprout-mcp-server@1.1.0`.

**Decisions made**: Existing npm auth token couldn't create new scoped packages — needed a granular access token. Saved the new token to `~/.npmrc`, `~/.claude/settings.json`, and `~/Developer/credentials/tokens.json`.

**Left off at**: All three MCP servers are published and up to date on npm. No further work needed.

**Open questions**: None.

---

## 2026-03-21 — v1.2.0: Full API coverage, marketing README

**What changed**: Added 11 new tools to reach 43 total, covering 100% of YNAB API v1.79.0. Added `ynabFetch` helper for direct HTTP calls to endpoints the ynab SDK doesn't support (category CRUD, money movements). Created marketing-grade README.md. Enhanced existing tools with richer metadata. Fixed version mismatch and misleading descriptions. Added 96 lines of new tests.

**Decisions made**: Used direct `fetch` via `ynabFetch` helper for newer API endpoints (categories, category groups, money movements) since the official ynab npm SDK v2.5.0 doesn't expose these. Kept the SDK for everything it does support. Intentionally omitted delta request support (`last_knowledge_of_server`) since MCP tools are stateless. Skipped deprecated debt fields (`debt_original_balance` etc.) to keep output clean.

**Left off at**: All implementation work is done. Next steps would be publishing v1.2.0 to npm (`npm publish`) and potentially adding the new tool count to the npm package description. Could also consider adding delta request support if users report rate limiting issues.

**Open questions**: Should we add `update_category` support for moving categories between groups (the API supports it but it's a niche operation)? Should we expose `last_knowledge_of_server` for power users who want incremental fetches?

---
