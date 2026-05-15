# Worklog

## 2026-05-15 — v1.7.0: summary mode on review_unapproved + tool description hardening

**What changed**: Three additive (backward-compatible) refinements driven by real failure modes hit during a long YNAB session. (1) `review_unapproved` accepts a new optional `summary: boolean` parameter. When `true`, the response omits per-transaction detail from both `ready_to_approve` and `needs_category_first`, returning only counts + by-payee aggregates (payee, count, total, flags). This fixes the 100KB+ overflow that forced subagent delegation on the full response during long-window audits. Default behavior unchanged for existing callers. (2) Tool descriptions for `review_unapproved`, `get_transactions`, and `update_transactions` got hardened with practical guidance learned in-session: `match_broken` is **not** API-fixable (always requires YNAB web/iOS UI), `import_payee_name_original` is the primary disambiguation field carrying processor flag + merchant + city/state, large batches can overflow the response cap (verify success by counting `"approved": true` in the saved file), and never compose transaction IDs by hand. (3) Response shape adds a top-level `summary: true|false` flag so callers know which payload shape they got.

**Decisions made**: Made `summary` a parameter rather than a separate tool to avoid splitting the API surface. The aggregation collapses ~113KB → ~5KB for the budget tested (99 unapproved across 18 payees). Kept the docs-only tool description updates in this minor bump rather than holding them for a major release — they document real failure modes a caller would hit otherwise. Did not add `merge_payees`, `approve_transactions_by_payee`, `split_transaction`, or a `summary` mode on `update_transactions` — those would be larger work requiring design + testing.

**Left off at**: index.js + package.json modified; committed but not yet published to npm. The companion `ynab-finance` skill in `ames-plugins` (renamed from `ames-claude` during this session) bumped to v3.13.1 with two new references: `subscription-audit.md` (7-step methodology) and `categorization-workflow.md` (two-pass categorize-then-approve pattern + ID handling + Amazon-via-Gmail cross-reference workflow). Published via the ames-plugins marketplace already.

**Open questions**: Worth adding `summary: true` mode to `get_transactions` for the same overflow class? The 6-month Work Expenses pull was 75KB. Worth adding `fields` filter to subset returned columns? Both would be additive minor bumps. Also: the YNAB JS Number arithmetic produced `-53.730000000000004` on a Capitol Theatre group total (IEEE-754 float drift on 25.68 + 17.60 + 10.45) — a `.toFixed(2)` wrap on group totals would clean it up as a v1.7.1 cosmetic patch.

---

## 2026-05-05 — v1.6.0: review_unapproved anomaly flags, composite ID handling

**What changed**: Three improvements driven by a live YNAB review session that uncovered failure modes the existing tools didn't catch. (1) `review_unapproved` now attaches a `flags` array to every transaction and aggregates them at the payee-group level. Six flag types: `manually_entered` (no bank import_id and not a transfer), `match_broken` (matched_transaction_id present but no import_id), `scheduled_transaction_realized` (composite ID like `uuid_YYYY-MM-DD`), `new_payee` (no transactions for this payee in last 60 days), `no_prior_amount_match` (payee has history but never at this exact amount), and `category_drift:was_X` (payee was previously in a different category). Implementation fetches 60 days of approved history in one extra API call and does all flag computation client-side. (2) New `normalizeTransactionId(id)` helper strips `_YYYY-MM-DD` date suffixes from composite scheduled-transaction IDs. `get_transaction` now uses it so lookups work for these IDs (previously returned 404). (3) Updated tool descriptions and README to document the new behavior.

**Decisions made**: Flag computation is client-side after one extra `getTransactions(sinceDate)` call rather than per-payee API calls; keeps latency predictable regardless of how many unique payees are in the batch. Floating-point amount comparison via `Set` is reliable here because milliunits are integers (e.g., 35710 / 1000 = 35.71 exactly in JS). The `match_broken` flag fires on the specific pattern that caused confusion in the live session: `matched_transaction_id` present with `import_id` null, indicating a hand-entered transaction whose match reference may have gone stale. `category_drift` only triggers when the unapproved transaction has a real (non-Uncategorized) category that differs from the payee's prior 60-day categories; avoids false positives from the first time a payee gets categorized.

**Left off at**: Pushed v1.6.0. Like v1.5.0, the npm package still needs `./publish.sh` to bump from 1.4.0 (package.json is behind index.js). Connector source updated; installed cache and npm publish are pending. Skill side: companion `ynab-finance` skill in ames-plugins got a new "Transaction Approval Workflow" section with a flags reference table and explicit batch-approval gate rules.

**Open questions**: Should the Amazon edge case be handled differently? Every Amazon charge has a unique amount, so `no_prior_amount_match` will fire on every Amazon transaction. The skill rule that elevates `manually_entered + no_prior_amount_match` to mandatory sign-off won't fire on Amazon (since they're bank-imported), so the noise is contained to display, but a future improvement could special-case payees with high amount variance.

---

## 2026-05-04 — v1.5.0: review_unapproved grouped by payee, get_overspent_categories

**What changed**: Two connector improvements discovered during a live YNAB review session. (1) `review_unapproved` now groups `ready_to_approve` transactions by payee with per-group count and running total — makes it practical to confirm/approve per-payee group rather than sifting a flat 20-item list. (2) New `get_overspent_categories(month)` convenience tool returns only negative-balance categories sorted by severity with a total overspent amount — replaces the pattern of calling `get_month` and filtering 60+ categories manually. (3) Fixed `list_scheduled_transactions` description to clearly state that auto-imported recurring charges don't appear there.

**Decisions made**: Kept `review_unapproved` response shape backward-compatible — `ready_to_approve.transactions` flat array replaced by `ready_to_approve.by_payee` groups. Skills and prompts that iterated the flat array will need to update, but this was the right call since per-payee review is the correct workflow. `get_overspent_categories` excludes "Internal Master Category" (Uncategorized, Ready to Assign) since those aren't real overspends.

**Left off at**: Pushed v1.5.0. Plugin still needs to be republished (`./publish.sh`) to update the npm package — local connector is updated, installed cache is not yet bumped.

**Open questions**: Should `review_unapproved` also surface unapproved positive transactions (income deposits not yet approved)? Currently only negative amounts are caught.

---

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
