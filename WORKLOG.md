# Worklog

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
