# Worklog

## Open items

- Rename the amesvt.com Cloudflare rate-limit rule, still named "Rate limit YNAB MCP dynamic client registration" although it covers six hosts; the rename would not commit through the dashboard and needs doing by hand (since 2026-09-08) (unverified)
- Per-connector rate-limit tuning needs a paid Cloudflare plan: the free plan caps period and mitigation at 10 seconds and allows one such rule per zone (since 2026-09-08)
- Dependabot alert 27 (`sharp`, libheif advisories, `worker/package-lock.json`) was expected to close on the next scan after the 0.35.4 pin; it was still open on 2026-09-22 although the lock resolves `sharp@0.35.4`, the first patched version (since 2026-09-14; https://github.com/oliverames/ynab-mcp-server/security/dependabot/27)
- Trim the repeated per-field input descriptions (for example `budgetId` on 60 tools); the tool list is still about 21K tokens (since 2026-09-14; https://github.com/oliverames/ynab-mcp-server/issues/23)
- Add an OAuth-authenticated post-deploy smoke check; hosted deploys are verified only by rebuilding the bundle locally, and `tools/list` has not been checked through OAuth against the hosted connector (since 2026-09-14; https://github.com/oliverames/ynab-mcp-server/issues/24)
- Run the decisive icon test (temporarily recolor `amesvt.com`'s favicon) to tell registrable-domain-only resolution from a domain-keyed Claude icon cache; Oliver chose to wait and re-check later (since 2026-07-30)
- Write-then-undo acceptance through the hosted connector needs explicit approval for the exact YNAB operation; a memo write was proven on the Test budget on 2026-07-18, undo was not (since 2026-07-15) (unverified)
- Restricted Mode removal review, public Claude Directory submission, and broader trademark review stay deferred pending Oliver's explicit approval (since 2026-07-15)
- A host may keep a manually entered connector-card label after reading new MCP metadata; refresh or reconnect before treating a cached label as the deployed title (since 2026-07-15) (unverified)
- Glama hosted deployment waits on Oliver adding a payment method, then deploying with env vars per the Desktop guide; also confirm Glama's rescan picks up 5.x (Dockerfile admin config uses pnpm/mcp-proxy) (since 2026-07-14) (unverified)
- Live smoke of the 5.0.0 audit and analytics tools against the real budget (offline suites only so far) (since 2026-07-14) (unverified)
- Diagnose the ~$94K Inflow balance `get_month` reports beside a $4K `to_be_budgeted` (since 2026-05-29; https://github.com/oliverames/ynab-mcp-server/issues/18)
- Owner to review and send the Gmail draft to Dela (YNAB Works-with-YNAB review): app-name choice ("Local MCP Server for YNAB" proposed) and ToS #6 acknowledgment; the name intersects the deferred repo rename (since 2026-07-05) (unverified)
- Rename the repository to `mcp-server-for-ynab`, deferred over Glama slug migration risk and orphaned plugin installs (since 2026-07-14; https://github.com/oliverames/ynab-mcp-server/issues/5)
- Build a dead-link resolver for `match_broken` (resolve `matched_transaction_id`; flag orphan vs live duplicate) (since 2026-06-01; https://github.com/oliverames/ynab-mcp-server/issues/17)
- Consider a granular npm automation token in 1Password and a pre-release `npm whoami` check in the release flow; `publish.sh` has no `whoami` check (since 2026-05-28) (unverified)
- If a YNAB call errors in Codex, confirm `[shell_environment_policy]` env propagates to MCP subprocesses on the current Codex build (since 2026-06-22) (unverified)
- Decide whether `get_transaction` should try `matched_transaction_id` as a third lookup, and whether the scheduled-fallback `reason` should point callers at `get_scheduled_transaction` (since 2026-05-15) (unverified)
- Check a future YNAB SDK (v2.6+) for a clear-match endpoint (since 2026-05-18) (unverified)
- Consider `summary` mode and a `fields` filter on `get_transactions` for the large-response class (since 2026-05-15) (unverified)
- Amazon charges always trip `no_prior_amount_match`; consider special-casing high-amount-variance payees (since 2026-05-05) (unverified)
- Decide whether `review_unapproved` should surface unapproved positive (inflow) transactions (since 2026-05-04) (unverified)
- Add a `create_payee` test to `test.js` (since 2026-04-09)
- Create 1Password items for Meta Access Token, Threads Access Token, Sprout API Token/OAuth Client, and UniFi Controller credentials (other repos) (since 2026-04-06) (unverified)
- Categorize the 20 uncategorized YNAB transactions identified in the 2026-04-06 review (since 2026-04-06) (unverified)
- Monitor downstream effects of the `list_budgets` response shape change from array to object (since 2026-03-22) (unverified)

## 2026-09-14 - Audited the connector against YNAB API 1.86 and the Claude tool surface

**What changed**: Five findings from a same-day audit, shipped as 5.4.0.
(1) YNAB API 1.86.0 (2026-07-01) added `goal_frequency`; `create_category` and
`update_category` now take `goalFrequency` (monthly / weekly / yearly) and
reject it client-side without `goalTarget` or alongside `goalTargetDate`, the
two combinations the API refuses. The 1.84 `internal` flag is surfaced on
categories and groups in `list_categories`, `search_categories`, and every
`formatCategory` result. (2) The tool list a client loads every turn was 92 KB
(about 23K tokens). The seven longest descriptions were cut to their operative
content, the placeholder output schema lost its per-tool description string,
and the list now measures 85 KB. (3) The server sends an `instructions` block at
initialize carrying the rules clients most often get wrong; the long form stays
in the `ynab://guide/*` resources. (4) Row caps close the timeout class that
prompted the earlier handoff: `get_transactions` stops at 500 non-delta rows
(`limit` up to 2000, `offset` to page) and returns a paged object only when
capped or paged, so the bare-array shape survives for small results;
`export_transactions` keeps the newest `maxRows` and reports truncation in a
second text block; `review_unapproved` degrades full -> compact -> summary past
`maxTransactions` (default 400) and reports `mode` plus a `notice`. (5) The
Worker's `sharp` override moved 0.35.3 -> 0.35.4, clearing Dependabot alert 27
(libheif advisories in a transitive miniflare dependency).

**Decisions made**: Kept an output schema on every tool because the README
records "structured contracts for app clients" as a deliberate decision;
shrinking it beat removing it. Trimmed descriptions rather than rewriting all
63, because input schemas, not descriptions, are most of the payload; the
remaining reduction would need per-field description cuts and was left for a
later pass. Caps change response shape only when they bite, and delta requests
are never capped because truncating a delta would desynchronise
`server_knowledge`.

**Verification**: `test:unit` 76/76 (7 new: goal-frequency rules and both
category writes with a mocked fetch, `capRows`, `reviewResponseMode`, the
`get_transactions` cap and delta bypass, export truncation, instructions
present). `test:safety` passes with new assertions for `limit` and
`goalFrequency`. Worker tests 25/25 with `sharp@0.35.4`; wrangler dry-run
builds; `release:check` 26/26. Tool-list payload measured before and after with
a local MCP client: 92,240 -> 85,078 bytes.

**Left off at**: Released as v5.4.0. `./publish.sh minor` published
`@oliverames/mcp-server-for-ynab@5.4.0`; the trailing registry check failed on
npm propagation lag again (about four minutes this time) and passed on re-run.
Bump commit `a061c23`, unsigned annotated tag `v5.4.0`, Release workflow green
with `mcp-server-for-ynab-5.4.0.mcpb`. Worker deployed as version `99713eb3` to
`ynab.amesvt.com` with the same 1Password deploy token as 5.3.0. Verified the
deployed bundle and the npm tarball both carry `version: "5.4.0"`,
`goal_frequency`, the instructions block, and the row-cap helper; live `/mcp`
returns 401 unauthenticated. Dependabot had not yet re-evaluated alert 27 at
push time; it should close on its next scan of `worker/package-lock.json` now
that the override pins `sharp@0.35.4`.

**Open questions**: NEW - the tool list is still about 21K tokens; the next cut is the
repeated per-field descriptions (for example `budgetId` appears on 60 tools),
tracked in #23. NEW - hosted-connector deploys are still verified only by
rebuilding the bundle locally; an authenticated post-deploy smoke check is #24.

---

## 2026-09-14 - Added transaction search and a transfer convenience from a live triage

**What changed**: Three connector findings from a live session on 2026-09-14
that was recording credit card payments through `ynab.amesvt.com/mcp`. First,
an unfiltered `get_transactions` on a real budget exceeded the client's ~120s
tool timeout, forcing a `search_payees` plus per-payee pull workaround. New
`search_transactions` fetches the (optionally account- and date-bounded) list
from YNAB and filters it server-side: `query` is a case-insensitive substring
match over payee name, raw bank import string, memo, account, category and
split rows; `amount` matches on absolute value with half-cent tolerance; results
are newest-first and page through `limit` / `offset` with `next_offset`.
Second, `payeeName: "Transfer : <Account>"` is rejected by YNAB with
`payee name must not start with an internal payee name`, and the
`transfer_payee_id` workaround was undiscoverable. `create_transaction` and
`create_transactions` now accept `transferToAccountId` or
`transferToAccountName`, fetch the account list once per call, and set the
destination account's transfer payee; mixing a transfer target with a payee is
rejected before any write. YNAB's own rejection now carries an error hint
pointing at the new fields. Third, `get_transaction` called with `id` failed
validation with no hint. The tool description and README now name
`transactionId`, and `parseToolExecuteInput` appends the accepted argument list
to every validation failure so a guessed key is self-correcting.

**Decisions made**: Server-side search rather than pagination on
`get_transactions`, because the timeout came from payload size rather than the
YNAB call and a filtered page is what the client actually wanted. Amount
matching ignores sign so a caller who saw "$12.34" on a statement does not have
to know the outflow convention. Name resolution prefers an exact match, then a
unique partial match, and reports the candidates when ambiguous rather than
guessing. Kept the transfer convenience to the two create tools named in the
handoff; scheduled transactions still take `transfer_payee_id`.

**Verification**: `npm run test:unit` 69/69 (11 new tests, including
handler-level tests with a mocked fetch for both create tools, the error hint,
and the search page shape). `npm run test:safety` passes with
`search_transactions` in the required read-tool set. `smoke:list-tools` lists
63 tools with writes enabled (was 62). Worker tests 25/25, `wrangler deploy
--dry-run` builds, `release:check` 26/26 after the README count moved to 59.

**Left off at**: Released as v5.3.0 the same day on Oliver's instruction.
`./publish.sh minor` published `@oliverames/mcp-server-for-ynab@5.3.0`; its
final `release:check:registry` step failed once only because npm had not yet
propagated the new `latest` tag, and passed on a re-run a minute later. Commit
`009b501` carries the bump, tag `v5.3.0` is unsigned annotated, and the Release
workflow produced `mcp-server-for-ynab-5.3.0.mcpb`. The Worker deployed as
version `d0dabe10` to `ynab.amesvt.com`; wrangler authenticated with the
"Cloudflare Personal MCP Deploy" token from the 1Password Development vault
(the service-account `op` needs `--vault Development`). Verified the bundled
Worker and the published tarball both contain `search_transactions` and
`version: "5.3.0"`; the live `/mcp` returns 401 unauthenticated as expected.
Not verified through an OAuth-authenticated `tools/list` against the hosted
connector, which needs a browser consent flow.

**Open questions**: Still open from 2026-09-08 - the amesvt.com rate-limit rule
name and the Dependabot alerts (partly addressed by #21).

---

## 2026-09-08 - Unblocked non-browser MCP clients at the Cloudflare edge

**What changed**: A third-party client (Meta's Muse) could not reach
`ynab.amesvt.com/mcp`. The reported cause was an IP or Origin problem; it was
neither. Cloudflare's zone-level Browser Integrity Check bans the
`Python-urllib/*` User-Agent and returns `error code: 1010` before any Worker
code runs. The block was zone-wide and method-agnostic, so discovery,
`/register`, `/token`, `/mcp` and `/sse` were all unreachable to that client
while `curl` and browser UAs sailed through. Added a WAF custom rule (action
Skip, Browser Integrity Check the only skipped component) scoped to the
machine-to-machine paths, leaving `/` and `/authorize` protected, plus a
rate-limiting rule on the unauthenticated `/register` DCR endpoint.

Extended the same pair to every self-hosted MCP connector: the six amesvt.com
hosts (ynab, skills, wave, parcel, lytho, workspace) share one skip rule and one
rate limit; `mcp.applecore.app` is a separate zone with its own matching pair,
scoped to its `/oauth/*` layout.

Separately, `MCP_ALLOWED_ORIGINS` listed `https://claude.ai` but not
`https://claude.com`, so browser requests from Claude's newer domain got 403
`invalid_origin`. Commit `027e06c` adds it. Documented both the edge
prerequisite and the origin rule in `docs/hosted-oauth-connector.md`.

**Decisions made**: Scoped the skip by path rather than disabling Browser
Integrity Check zone-wide, so the browser consent flow keeps its protection.
Skipped only the BIC component, never the broad "all managed rules" or Super Bot
Fight Mode options. Set the shared amesvt.com rate limit to 10 per 10s rather
than 5, because one counter now spans six hosts and a client registering across
several in sequence could otherwise trip it. The Worker's Origin handling needed
no change — it already returns early on a missing `Origin`, per the MCP spec.

**Verification**: Reproduced the block by varying only the User-Agent, then
confirmed after each rule that all seven `/mcp` endpoints reach the app under
`Python-urllib/3.11` while `/authorize` and the site roots still return 1010 for
that UA and 200 for a real browser. Rate limits confirmed behaviourally: ten
requests then 429, with recovery after the window. Worker tests 25/25 before the
deploy; `wrangler deploy` succeeded and the `claude.com` origin verified live
after propagation.

**Left off at**: All seven connectors reachable and verified. Repo clean, commit
pushed.

**Open questions**: NEW - the amesvt.com rate-limit rule is still named "Rate
limit YNAB MCP dynamic client registration" although it now covers six hosts;
the rename would not commit through the dashboard and needs doing by hand. NEW -
Cloudflare's free plan caps the rate-limit period and mitigation at 10 seconds
and allows one such rule per zone, so per-connector tuning needs a paid plan.
Still open - Dependabot reports 12 vulnerabilities (8 high, 4 moderate) on the
default branch, surfaced during the push and not addressed here.

---

## 2026-08-27 - Released 5.2.0 and fixed the bundle build that blocked it

**What changed**: Thirty-one commits had accumulated since v5.1.1 with no
release. The first publish attempt failed at `build:mcpb` with "Missing:
fast-uri@3.1.6 from lock file". `build-mcpb.mjs` staged a production-only
`package.json` beside a copy of the full `package-lock.json`; `npm ci` verifies
the two agree, so the trimmed manifest no longer described the tree the lock had
resolved. The mismatch was latent until the recent dependency refresh moved that
transitive package. Commit `92b25f4` installs with the project's real manifest
and writes the trimmed bundle manifest afterwards. Published 5.2.0.

**Decisions made**: Chose a minor bump because the backlog carries features
(native OAuth callback redirects, Claude-discoverable branding) alongside fixes
and security bumps.

**Verification**: `publish.sh minor` ran the full gate (unit, safety,
smoke:list-tools, worker tests, wrangler dry run, release:check) before touching
version files. The published bundle carries the trimmed manifest with 3
production dependencies, no devDependencies, and its node_modules. Registry
check confirms npm latest is 5.2.0, and the v5.2.0 GitHub release was created.

**Left off at**: Released and clean at 5.2.0.

**Open questions**: None new.

---

## 2026-08-26 - Reviewed and cleaned up an uncommitted work-in-progress change

**Context**: The tree carried an uncommitted change touching `index.js`,
`README.md`, and `package.json` on top of `1c32d9b`. Oliver asked for a review
of completeness and reasoning, then for the findings to be fixed. The committed
work in `1c32d9b` held up on inspection; the uncommitted work did not.

**What changed** (commit `f6c7160`):

- Deleted the caching layer. `SimpleCache`, `responseCache`, `generateCacheKey`,
  and `withCache` were never called from any code path, so `YNAB_CACHE_ENABLED`
  and `YNAB_CACHE_TTL_MS` did nothing while the README claimed read-only tools
  cached automatically. A working version would also need write-time
  invalidation and a size bound, and had neither.
- Reverted the `YNAB_API_HOST` override. `assertYnabApiUrl` is the guard that
  keeps the bearer token from reaching a non-YNAB host, and the override made
  that guard follow an unvalidated environment variable. It was half-wired
  besides: `YNAB_API_HOST` went into `YNAB_RUNTIME_KEYS`, but the constant reads
  `process.env` at line 23, before `resolveYnabRuntimeConfig` runs, and that
  function never writes back to `process.env`. A config-file value would have
  shown as found in diagnostics and then been ignored.
- Removed an unused `maxRetries` in `createYnabRateLimiter`. The real retry loop
  reads `YNAB_HTTP_RETRIES` itself, and the dead copy clamped to a different
  minimum.
- `envNumber` now separates an unparseable value from an in-range parse below
  the minimum, so `YNAB_RATE_LIMIT_BURST=0` no longer warns "is not a valid
  number".
- Capped all seven memo schemas at 500 characters, matching YNAB's spec. The
  README had claimed a 200-character memo cap that no schema enforced.
- Kept the incoming `.max(50)` on both category group name fields.
- Rewrote the README's validation sections to describe real behavior, including
  why payee names cap at 200 on transactions and 500 on the payee endpoints.

**Decisions made**:

- Field limits come from YNAB's own OpenAPI spec, fetched from
  `https://api.ynab.com/papi/open_api_spec.yaml` on 2026-08-26, not from the
  bundled `ynab` SDK. The SDK's generated types carry no `maxLength`.
- Reverted the hand bump to 5.1.2 in `package.json` and `serverInfo` rather than
  finishing it. `package-lock.json`, the six plugin manifests, and
  `worker/src/brand-assets.js` were all still at 5.1.1, and `publish.sh` owns
  the bump. This keeps the deliberate 5.1.2 release hold intact.
- Exported `envNumber` so the warning paths can be tested. It joins the existing
  test-support export surface rather than widening the runtime API.

**Verification**: `test:unit` 57/57, including two new tests covering the
`envNumber` warning paths and all four field-length caps. A mutation check
(removing one `.max(500)`) confirmed the memo test fails without the cap.
`smoke:list-tools` connects and lists 62 tools. `npm test` was deliberately not
run, since it writes to the live budget.

**Left off at**: `main` clean and pushed at `f6c7160`. Version deliberately
still 5.1.1 everywhere. The 5.1.2 release remains held exactly as the
2026-07-18 entry describes, and the release steps there are still the ones to
follow when Oliver wants to ship.

**Open questions**: None new. Still open: the held 5.1.2 npm publish and hosted worker deploy, unchanged by this session.

---
## Earlier history (before 2026-08-23)

- 2026-08-05 - Fixed seven defects from a live hosted-connector triage: `review_unapproved` groups gained `category_names`/`mixed_categories` (null `category_name` when mixed) and `mixed_amount_signs` with inflow/outflow totals; `update_transactions`/`approve_transactions` report `newly_approved_count`, `already_approved_count`, `approval_state_unknown_count`; compact rows keep `matched_transaction_id` for `match_broken`; `search_categories` tokenizes and OR-matches name plus group with `matched_on`/`matched_terms`; HTML entities decoded once in `ok()` over an allow-list; composite scheduled IDs documented as writable. 45 unit tests (17 new), 25 Worker tests. Same PR fixed the `security` CI job: `fast-uri` override to `4.1.2` (GHSA-7p8r-x3mc-p8w7; old 3.1.4 pin was vulnerable), `ip-address` GHSA-mwp4-54f8-5fhr, `hono` GHSA-8j4g-w8fx-2239; both audits zero.
- 2026-07-30 - Root cause of the wrong Claude connector icon: Claude resolves at the registrable domain, and `amesvt.com/favicon.ico` returned the Pages SPA fallback (HTTP 200, `text/html`), so it took the green amesvt mark; a 200 ends the fallback chain. `serverInfo.icons` confirmed ChatGPT-only (sosumi.ai renders with none). Cut `/favicon.ico` to one 32x32 frame (370,070 -> 4,286 bytes), added `/favicon.svg`, reversed the no-SVG-favicon assertion (the wordmark still may not be a favicon). Worker `e433958f-44b6-46d9-9f49-e4793eb9d394`; verify deploys by ETag (SHA-256 of body), not raw `curl` sizes. Fixing the apex and `workspace.amesvt.com` still rendered green after reconnect.
- 2026-07-29 - Favicon experiments for Claude: Blurple tree artwork with 16/32/180/256px PNGs and a 256px `serverInfo.icons` entry (commit `861e2ac`, Actions run `30500927041`, Worker `8f97efb0-ae24-418a-80b0-f444a6dcd710`), then a six-frame ICO with `max-age=0, must-revalidate` to mirror TinyFish (Worker `12a23a70-249d-47d3-8bb2-c55c873066b4`); the ICO was reverted on 2026-07-30.
- 2026-07-22 - Dependency-only fix for root and Worker security findings, folding in the open maintenance branch before closing it; both audits zero, 46 live checks, 28 unit, 24 Worker tests, all five CI jobs green.
- 2026-07-18 - "ChatGPT reads but can't write" is not a server defect: the consent box "Allow write access" is unchecked by default, giving a read-only YNAB token and no write tools in `tools/list`. Added host-aware `writeEnableGuidance()` and a `write_enablement` hint in `ynab_auth_status`; `ROOT_CAUSE.md` added. Fixed `publish.sh` bumping `worker/src/ynab-mcp.js` instead of `worker/src/brand-assets.js` (commit `6798b8f`). 5.1.2 release prepared but held; tags must be unsigned annotated because SSH signing fails headless.
- 2026-07-17 - Claude.ai icon investigation, no code change: `POST /mcp` rejects `initialize` without a bearer token, so `serverInfo.icons` is visible only after OAuth; Claude does not read it for custom connectors (anthropics/claude-ai-mcp #152). Earlier domain-recognizability hypotheses were retracted as unverified.
- 2026-07-16 - Hosted connector icon now derives from the canonical Codex `codex/assets/icon.png` via a deterministic generator, with `/assets/ynab-app-icon.png` kept as an alias. Worker `8947cacc-784b-41fa-a37b-ec278b175031`; icon SHA-256 `4dc3adc4ec2ae657be39392d470f714b7839ba959612a274db8bdd0db8cc8773`.
- 2026-07-15 - v5.1.1: local stdio server renamed `YNAB Local` while the hosted connector stays `YNAB`; npm tarball and GitHub Release `v5.1.1` verified. Commit `70a0e81`, tag `v5.1.1`. A running MCP process may need a restart to show the new name.
- 2026-07-15 - Hardened hosted transport: untrusted browser Origins rejected before OAuth on `/mcp` and `/sse`, no-Origin clients allowed per the MCP transport model; hostname-scoped one-year HSTS without `includeSubDomains` (the Worker does not own every subdomain); `workers.dev` disabled; privacy page expanded; display name `YNAB`. Worker `7ec69139-5eeb-42b7-ba24-47861647c49a`, commit `3b3162a`.
- 2026-07-15 - OAuth fixes and three-host acceptance: concurrent tabs overwrote origin-wide cookies, so cookies were namespaced (Worker `fb1cb3da-2aae-49ca-9ef1-02ee2efb7d07`); Mistral's embedded browser returned no cookie, so consent and callback state moved to 192-bit one-time KV records with keyed CSRF hashes (Worker `c9f13970-3d78-437e-afc6-2015c04daaef`; KV has no compare-and-swap, so consumption is not atomic). CSP allows validated dynamic redirects (`30bca1c`), full catalog got titles and output schemas (`2d94a81`), docs `9cf65c6`. ChatGPT, Claude.ai, and Mistral all completed OAuth with `writes_enabled: true`; CI `29446432189`, Worker `e83324b1-277e-4cef-b068-e0f2b7b29525`. Restricted Mode allows 25 non-owner tokens; removal review takes 2 to 4 weeks.
- 2026-07-15 - Hosted identity and sanctioned "Works with YNAB" mark (SVG plus 196x78 PNG) with the required non-affiliation notice; only the integration mark is licensed by YNAB's API Terms, not the app icon. Worker `3a00f10f-1c39-4985-8d98-f11a7978af6a`. Directory submission draft written, not submitted.
- 2026-07-15 - v5.1.0: hosted OAuth connector live at `https://ynab.amesvt.com/mcp` (Streamable HTTP and SSE, dynamic registration, S256 PKCE, one-time consent, CSRF, AES-GCM token and undo encryption with `DATA_ENCRYPTION_KEY`, refresh-race handling, paginated revocation); read-only default with explicit write opt-in; release script runs all gates before changing version files. Worker `835aa177-ce67-43b0-8709-24f6f44e8481`. An earlier Safari error was stale Tailscale DNS.
- 2026-07-14 - v5.0.0: category workflows (`merge_category`, `retire_category`, `prepare_split_for_matching`), audits, analytics, undo journal (`~/.ynab-mcp-undo.json`), 6 prompts and 4 `ynab://guide/*` resources, rate-budget warnings, TDQS description sweep, Glama listing claimed; 47 -> 58 tools. Version is 5.0.0 because `publish.sh` bumped before its checks and a rerun double-bumped. Not adopted: milliunit params, Code Mode, OAuth.
- 2026-07-05 - v3.2.0: parameter-level API coverage against spec v1.85.0 (`includeAccounts`, `lastKnowledgeOfServer`, split conversion via `subtransactions`, `importId` addressing with ambiguity refusal); batch verification in one bounded list request instead of N+1 (was burning the ~190 req/hour budget); `secureFetch` caps every body including SDK calls; startup SDK wiring assertion; Dockerfile fixes the 2026-06-04 Glama build failure. Branch `claude/ynab-api-coverage-review-5g9gty`.
- 2026-07-02 - v3.1.0: fixed `release:check` and `sync:plugin` still reading the moved root `.codex-plugin/`; `review_unapproved` now fetches full history (YNAB defaults `since_date` to one year); 429 retries for any method, 5xx and network retries for reads only (`YNAB_HTTP_RETRIES`); `envNumber()` guards against NaN (a NaN burst caused a busy loop); executor tools validate with zod; offline unit tests and CI/release workflows added.
- 2026-06-22 - Codex dropped the marketplace because `source.path` `"./"` is unresolvable in Codex; moved the plugin to `codex/` (`f1a1d83`) and switched env to `${VAR}` substitution resolved from `[shell_environment_policy.set]` (`f54ccb9`).
- 2026-06-18 - Repo became the standalone YNAB marketplace replacing `ames-connectors`, with Claude, Codex, Hermes, and Antigravity manifests; plugin configs set `YNAB_ALLOW_WRITES=1` while direct registration stays read-only. Commits `64a7263`, `6ed7467`, `0ee0157`.
- 2026-06-01 - First GitHub release of v2.1.0 with MCPB (https://github.com/oliverames/ynab-mcp-server/releases/tag/v2.1.0) plus `round2()` fixing float drift in group totals (`d91696e`); folded into unreleased 2.1.0 rather than 2.1.1.
- 2026-05-29 - Categorization ergonomics: `review_unapproved` `compact`, `update_transactions` `returnSummary`, new `approve_transactions` and `reassign_payee_transactions` (the YNAB API has no payee delete or merge); 45 -> 47 tools. Left the `get_month` Inflow balance untouched pending diagnosis.
- 2026-05-28 - v2.0.0: write tools hidden unless `YNAB_ALLOW_WRITES=1` (breaking), read/destructive hints, host pinning, no redirects, timeouts, token redaction, rate limiting, `YNAB_API_TOKEN_FILE`; hosted OAuth pattern documented. Publish blocked: `npm whoami` 401 with both on-disk and vaulted tokens; tag `v2.0.0` points at `48a3651`. npm was then four releases behind (latest 1.7.1).
- 2026-05-27 - v1.8.3: `update_transactions` refetches and verifies every batch update after a live YNAB anomaly where `approved: true` persisted but `categoryId` did not; retries mismatches once, then errors. Added `smoke:batch-verify`.
- 2026-05-27 - v1.8.2: MCP smoke scripts, release consistency checker, and an MCPB build script that refuses to overwrite without `--force`.
- 2026-05-21 - `pretest` now probes the MCP SDK import and runs `npm ci` when dependencies are broken (a corrupted `ajv` tree had slipped past the old existence check); live tests use only visible non-internal categories and restore category notes.
- 2026-05-18 - v1.8.1: corrected the `match_broken` description: only `matched_transaction_id` is API-immutable; the transaction itself is fully mutable (confirmed live).
- 2026-05-15 - v1.8.0: `get_transaction` falls back to the scheduled template on a 404 for composite IDs, returning `resource_type: "scheduled_transaction"`; detection uses the original ID because normalization strips the suffix.
- 2026-05-15 - v1.7.1: `pretest` installs missing deps; `get_transaction` test skips stale composite IDs. v1.7.0 was never published. Commits `1351755`, `e366a1f`.
- 2026-05-15 - v1.7.0: `review_unapproved` `summary` mode (~113KB -> ~5KB) and hardened tool descriptions.
- 2026-05-05 - v1.6.0: `review_unapproved` anomaly flags (`manually_entered`, `match_broken`, `scheduled_transaction_realized`, `new_payee`, `no_prior_amount_match`, `category_drift`) from one 60-day history fetch; `normalizeTransactionId` for composite IDs.
- 2026-05-04 - v1.5.0: `review_unapproved` grouped by payee (breaking for flat-array callers); new `get_overspent_categories`.
- 2026-04-09 - v1.3.0: `YNAB_OP_PATH` made opt-in, all tools migrated to `registerTool`, `create_payee` added for API v1.82; published.
- 2026-04-06 - 1Password CLI fallback for credentials via `execFileSync` with a 10s timeout; env vars stay primary.
- 2026-03-22 - v1.2.1: nine-iteration audit fixing split/transfer classification, snake_case schemas, nullable update fields, and 14+ missing response fields; verify against the OpenAPI spec, not SDK types (SDK types were wrong on `goal_target_date` and `import_id`). `list_budgets` changed from array to object.
- 2026-03-21 - v1.2.0: 43 tools covering YNAB API v1.79.0 via a `ynabFetch` helper for endpoints the SDK lacks; published to npm. Creating new scoped packages needed a granular token with publish scope.
