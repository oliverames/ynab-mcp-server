# Worklog

## 2026-07-18 - Diagnosed "ChatGPT reads YNAB but can't write"; host-aware write guidance

**Context**: ChatGPT could read YNAB data but no transaction-mutation tool was
available, and the YNAB namespace later disappeared from the tool surface.
Full diagnostic prompt worked through end to end.

**Root cause (no server defect)**: Write tools are gated per session at
OAuth-consent time. The hosted consent screen's "Allow write access" box is
unchecked by default (`worker/src/pages.js:73`); unchecked → `readOnly:true`
(`ynab-handler.js:274`) → YNAB issues a read-only token, grant scope `["read"]`,
`writesEnabled:false` prop → `createYnabServer({writesEnabled:false})` →
`registerTool` returns `undefined` for every write tool (`index.js:1234`), so
they never enter `tools/list`. A correct client shows only read tools by design.
Secondary possibility: a client-side enablement gate (developer mode / workspace
plan / admin approval). Both are client-side. Whether a given ChatGPT plan/mode
may invoke custom-MCP writes is set by OpenAI and in active rollout; rely on
OpenAI's live docs and the workspace, not a fixed claim.

**Evidence gathered**:
- `npm run test:safety` PASS, `npm run test:unit` PASS (28/28).
- Live hosted endpoint healthy: `/mcp` → 401 Bearer challenge; OAuth metadata
  advertises `scopes_supported:["read","write"]`.
- End-to-end write PROVEN on the **Test** budget / MCP Smoke Checking account
  (id `ebbf3adf-…`): memo write → independent read-back match → idempotent
  double-set (no duplication) → cleared → verified. Production untouched.
- 2026-07-15 acceptance already recorded `writes_enabled:true` in ChatGPT for a
  write grant → read-only consent is the leading trigger.

**Change made (diagnostic only; no defaults/registration changed)**:
- Added `writeEnableGuidance()` — host-aware: hosted OAuth users are told to
  reconnect and check "Allow write access" instead of the impossible
  "restart with YNAB_ALLOW_WRITES=1"; derived from
  `runtime.tokenSource.source === "ynab_oauth"`.
- `ynab_auth_status` now returns a `write_enablement` hint and names the
  READ-ONLY state in its message; `writeDisabledResult` uses the same guidance.
- Verified both branches with an in-memory MCP client probe (assertions passed).
- Docs: `ROOT_CAUSE.md` (new), troubleshooting sections in `worker/README.md`
  and `docs/hosted-oauth-connector.md`.

**User action required (client side)**: call `ynab_auth_status` in ChatGPT; if
`writes_enabled:false`, reconnect the connector with the write box checked. If
writes still won't invoke after a write grant, it's client-side enablement, not
the connector.

**Release prep (5.1.2) — PREPARED BUT HELD at Oliver's instruction**: Also fixed
a `publish.sh` stale-path bug — it rewrote `worker/src/ynab-mcp.js` (no version
literal) instead of `worker/src/brand-assets.js` where `REMOTE_SERVER_INFO`'s
version now lives, so the hosted version was never bumped and `release:check`
would abort mid-run (commit 6798b8f). Full release preflight is GREEN at 5.1.1:
`test:unit` 28/28, `test:safety`, `smoke:list-tools` (62 tools), worker tests
24/24, `release:check`, `wrangler deploy --dry-run`. `npm whoami` → `oliverames`
(publish auth OK). `wrangler whoami` → NOT authenticated (worker deploy blocked
headlessly).

**Left off at**: version held at 5.1.1, tree clean, everything pushed. Oliver
chose to hold the npm publish and skip the hosted worker deploy for now. The new
`write_enablement` diagnostic is on `main` but not yet on npm (`@latest` 5.1.1)
or the live worker (`ynab.amesvt.com` still 5.1.1). To ship when ready:
`./publish.sh patch` (bumps to 5.1.2 + publishes) → commit the bump →
`git tag -a v5.1.2 -m v5.1.2` (unsigned; SSH signing fails headless) →
`git push && git push --tags` (fires release.yml GitHub release + MCPB) →
`cd worker && npx wrangler login && npx wrangler deploy`.

**Open questions**: none technical. The ChatGPT-write symptom is resolved by
user re-consent (client side); the release is a separate, deferred shipping step.

## 2026-07-17 - Claude.ai custom connector icon investigation (no code change)

**Context**: The hosted connector's custom icon renders in ChatGPT but not in
Claude.ai, where it shows a generated "Y" letter monogram. Investigated whether
anything on the server side could fix it.

**What was verified**:
- The Worker advertises the icon through every server-side channel and all are
  live (HTTP 200): MCP `serverInfo.icons` (HTTPS URL), `/favicon.ico`,
  `/favicon-16x16.png`, `/favicon-32x32.png`, `/apple-touch-icon.png`,
  `/assets/icon.png`, HTML `<link rel="icon">`, and `og:image`. Neither
  `.well-known` OAuth document carries a `logo_uri` (none is defined for either).
- ChatGPT renders the icon because it reads `serverInfo.icons` from the
  `initialize` response, which the connector sends correctly.
- Live probe (2026-07-17, second session): `POST /mcp` rejects `initialize`
  itself without a bearer token (`{"error":"invalid_token"}`), so
  `serverInfo.icons` is only visible *after* OAuth. Combined with no `logo_uri`
  in either `.well-known` doc, the authenticated `initialize` response is the
  single place the brand icon is exposed — which is exactly why a post-auth
  reader (ChatGPT) sees it and a pre-auth snapshot sees only the "Y" fallback.
  `GET /assets/icon.png` returns HTTP 200, `image/png`, 777,333 bytes, no auth.
- Claude.ai does **not** read `serverInfo.icons` for custom connectors. This is
  the one icon channel the server controls, and it is the one Claude ignores.
  Source: anthropics/claude-ai-mcp issue #152 (open). This is the single solid,
  current web-verified fact from the investigation.

**Conflict left unresolved**: Oliver's live connector list (screenshot) shows
several connectors with branded icons, including Meta Ads which carries a
"Custom" tag and shows the Facebook icon. So in the current Claude.ai UI a
Custom-tagged connector CAN show a branded icon, which contradicts issue #152's
"custom connectors always show a generic globe" wording. The public record
could not be reconciled with the live UI; treat the live UI as authoritative
and issue #152's "always" wording as stale or partial. Custom-vs-directory is
therefore NOT the discriminator for whether an icon appears.

**Explicitly retracted (were inference, not verified)**: earlier hypotheses in
this session that Claude resolves connector icons via domain recognizability /
Google's favicon service, and that the icon-bearing connectors win because they
are well-known domains. The mechanism Claude uses to resolve the icon Meta Ads
does show is unknown and could not be sourced. A local `curl` probe only showed
that a common public favicon crawler had no indexed favicon for
`ynab.amesvt.com` or `amesvt.com`; that says nothing definitive about Claude's
resolver.

**Decision**: No code change. The server-side icon surface is already complete
and correct; nothing on the origin can force Claude.ai to render it today.

**Open questions / next tests** (both are on the client side, not the server):
1. Compare the exact connector URL/domain of the working Meta Ads entry against
   `ynab.amesvt.com` — a concrete, readable difference.
2. Remove and re-add the YNAB connector in Claude.ai. If the "Y" becomes an
   icon, it was a stale cache from before the icons existed; if it stays, the
   resolution is not reaching the origin and a Connectors Directory submission
   is the realistic fix. Directory submission remains deferred pending Oliver's
   approval and YNAB Restricted Mode planning (unchanged from prior entries).

---

## 2026-07-16 - Match the hosted connector icon to Codex

**What changed**: Replaced the hosted connector's YNAB App Store artwork with
the exact canonical Codex plugin icon from `codex/assets/icon.png`. Added a
conventional multi-size `favicon.ico`, 16 px and 32 px PNG favicons, an Apple
touch icon, and matching page metadata. The legacy icon URL remains as a
compatibility alias. A deterministic generator now keeps every hosted variant
derived from the Codex source.

**Decisions made**: Use one canonical source rather than maintaining separate
host-specific artwork. Preserve `/assets/ynab-app-icon.png` for existing
consumers while advertising `/assets/icon.png` in MCP and page metadata.

**Verification**: Worker tests (24), root unit tests (28), safety checks, the
release-consistency check, and Wrangler deployment dry-run passed. Two
successive icon generations were byte-identical. Production version
`8947cacc-784b-41fa-a37b-ec278b175031` serves `/assets/icon.png` with the same
SHA-256 as the Codex source,
`4dc3adc4ec2ae657be39392d470f714b7839ba959612a274db8bdd0db8cc8773`.
The live ICO contains 16 px, 32 px, and 48 px images, and every public icon
endpoint returns the expected image content type.

**Left off at**: The production Worker is deployed and the source change is
fully verified.

**Open questions**: Claude's external favicon cache may take time to reindex
the corrected site. The production discovery surface itself is complete.

---

## 2026-07-15 - v5.1.1 local server name and release closeout

**What changed**: Renamed the local stdio MCP server identity to `YNAB Local`
and released `@oliverames/mcp-server-for-ynab@5.1.1`. The standalone Codex
marketplace installation is enabled at v5.1.1. The Cloudflare-hosted connector
continues to identify as `YNAB`; only its version metadata was aligned to
v5.1.1 for release consistency.

**Decisions made**: Kept the hosted and local server identities deliberately
separate. Left generic references to the connector as an “YNAB MCP connector”
unchanged because they are descriptions, not the local server display name.

**Verification**: Root unit tests (28), safety checks, root live tests (46
passed; 4 explicitly skipped), and Worker tests (24) passed. Wrangler
deployment dry-run and the release-consistency check passed. The published npm
tarball was fetched and verified to contain `serverInfo = { name: "YNAB Local",
version: "5.1.1" }`. GitHub Release `v5.1.1` published successfully with the
MCPB asset.

**Left off at**: Commit `70a0e81` and tag `v5.1.1` are pushed to `main`; the
repository and the ames-plugins marketplace are clean. KitchenSync's earlier
publish refusal is resolved: its previously untracked `agents/openai.yaml` is
now a tracked generated Codex skill manifest.

**Open questions**: None. An already-running MCP process may need a new Codex
task or restart to reload the local server display name.

---

## 2026-07-15 - Harden hosted transport, privacy, and display metadata

**What changed**: The Cloudflare Worker now rejects untrusted browser Origins
before OAuth on `/mcp` and legacy `/sse`, while preserving no-Origin
native/server clients. The privacy page now states its update date, Cloudflare
storage role, persistent and transient retention behavior, and delivery of tool
results to the connected MCP client. Added hostname-scoped HSTS and disabled
the unused `workers.dev` endpoint. Connector display metadata, OAuth protected
resource metadata, and bundled host manifests now use `YNAB`; package IDs and
the `ynab.amesvt.com` hostname remain unchanged. Updated the Claude Directory
submission draft and local privacy document to reflect the deployed connector.

**Decisions made**: The browser allowlist is explicit for ChatGPT, Claude, and
Mistral origins, while absent Origin remains valid per the MCP transport model.
HSTS is one year without `includeSubDomains`, because this Worker does not own
every `amesvt.com` subdomain. The YNAB app icon remains the published connector
icon. No Restricted Mode request or public-directory submission was made.

**Verification**: Worker tests passed (24), root unit tests passed (28), as
did safety and release checks plus Wrangler dry-run validation. Production
version `7ec69139-5eeb-42b7-ba24-47861647c49a` returned 403 with no CORS allow
header to `Origin: https://example.invalid`, returned the expected OAuth 401
challenge for no-Origin clients, and served `resource_name: "YNAB"` with HSTS.
The live YNAB icon SHA-256 remains
`b1b3180d79d59548fea1ddff1b58622ce66c3ffd1951d416ab4f5d9b63324e0a`.

**Left off at**: Commit `3b3162a` is pushed to `main`; local and
`origin/main` match. The hosted service is deployed and the repository is
clean.

**Open questions**: **Still open**: a host may retain a manually entered
connector-card label even after it reads the new MCP metadata; refresh or
reconnect the existing client registration before treating a cached label as
the deployed server title. Public listing and YNAB Restricted Mode review stay
deferred pending explicit approval.

---

## 2026-07-15 - Three-host OAuth acceptance and app-client contracts

**What changed**: Completed the remaining hosted-connector release gates after
the cookie-free OAuth work. `30bca1c` allows only validated dynamic MCP redirect
targets in authorization-page CSP and form actions, while preserving the
connector-origin default for all other forms. `2d94a81` applies human-readable
titles, input schemas, output schemas, matching `structuredContent`, and
private/bounded impact hints across the full tool catalog. The production
Mistral connector record now carries the square app-list icon and the same
non-affiliation description as the earlier connector. `9cf65c6` reconciles the
submission guide with the separate connector-card and hosted-consent icon
roles.

**Decisions made**: Treat host presentation fields as host-owned state rather
than assuming MCP `serverInfo.icons` will populate every client. Keep the
square app icon on connector cards and the permitted “Works with YNAB” mark on
hosted authorization, privacy, and deletion pages. A write-enabled grant only
exposes write tools; destructive and bulk-filter actions still require the
shared per-call confirmation gates.

**Verification**: ChatGPT, Claude.ai, and Mistral Vibe Work each completed the
real OAuth flow, invoked the connector, returned current budget names, and
reported `writes_enabled: true`. Acceptance chats are recorded at
`https://chatgpt.com/c/6a57daaf-89c8-83ea-b232-5e58401c629a`,
`https://claude.ai/chat/c5132430-bbfc-4905-bb7b-23df6b92298d`, and
`https://chat.mistral.ai/work/5343e6ca-af1e-4825-a32e-0d7516093d78`.
Local verification passed with 46 live root checks and 21 Worker tests; CI run
`29446432189` passed. Cloudflare deployment
`e83324b1-277e-4cef-b068-e0f2b7b29525` serves 100% of production traffic.

**Left off at**: `main` and `origin/main` include the completed implementation
and documentation through `9cf65c6`. The private connector objective and all
three host-acceptance tasks are complete.

**Open questions**: **Still open**: an actual write followed by undo needs
explicit approval for the exact YNAB operation. Restricted Mode removal,
public directory publication, and broader trademark review remain separate
rollout decisions.

---

## 2026-07-15 - Embedded-browser OAuth no longer depends on cookies

**What changed**: Replaced the hosted connector's consent and YNAB callback cookie bindings after live Mistral Work acceptance proved its embedded OAuth browser did not return the first-party cookie even on a fresh, single consent flow. Consent now uses a 192-bit opaque record ID and a separate 192-bit hidden CSRF token whose keyed hash is stored with the parsed MCP authorization request. The POST fetches and deletes that one-time record before validating the token. YNAB callback state is also 192-bit, HMAC-verified, tied to the original dynamic-client request and access choice, stored for 10 minutes, and deleted before callback validation. PKCE S256, the fixed callback URI, CSP `form-action 'self'`, read-only default, and encrypted YNAB tokens are unchanged.

**Decisions made**: Kept the existing `COOKIE_ENCRYPTION_KEY` secret name to avoid an unnecessary credential migration, but it now signs server-side consent and state records as well as the separate deletion-form cookie. Cloudflare KV has no compare-and-swap operation, so the implementation does not claim atomic consumption; sequential replay is rejected, records have unguessable 192-bit identifiers, invalid submissions consume their record, and the TTL remains 10 minutes. Added no-cookie, replay, tamper, cross-consent, and overlapping-callback regressions. Restricted Mode is documented as a separate rollout constraint: YNAB exempts the app owner, permits 25 access tokens for other users, blocks new authorizations at the cap, and says removal review takes 2 to 4 weeks. No review form or public directory submission was made.

**Left off at**: Deployed Cloudflare Worker version `c9f13970-3d78-437e-afc6-2015c04daaef`. A production probe registered two independent MCP clients, loaded and submitted both consent forms without a cookie jar or any `Set-Cookie` response, and received two YNAB redirects with PKCE S256, the fixed connector callback, and read-only scope. Both simulated denial callbacks validated without cookies. Sequential callback replay and a tampered state were rejected, while the second legitimate state remained valid after the tamper probe. Offline checks passed with 28 core tests, 16 Worker tests, the safety suite, 62-tool discovery, release consistency, and a Wrangler dry run.

**Open questions**: **Resolved this session**: fresh Claude.ai, ChatGPT, and Mistral Vibe Work connector flows completed OAuth and a real budget-list read. **Still open**: write and undo acceptance requires explicit approval for the exact financial operation.

---

## 2026-07-15 - Concurrent OAuth tabs no longer overwrite security cookies

**What changed**: Fixed the live Claude.ai and Mistral Work acceptance failure where a fresh consent form returned “Consent form expired or invalid” on its first submit. The connector used one origin-wide CSRF cookie and one origin-wide upstream OAuth state cookie. Opening authorization pages for two MCP clients at once made the later tab overwrite the earlier tab's cookie. Consent CSRF cookies are now namespaced by the opaque consent ID, and YNAB callback cookies are namespaced by the opaque OAuth state. Abandoned cookies retain the existing 10-minute expiry.

**Decisions made**: Kept every security property intact. Each cookie is still random-request-bound, HMAC-verified, HttpOnly, Secure, `SameSite=Lax`, host-only, single-use, and backed by a one-time KV record. No replay or CSRF check was weakened. Added separate regressions for concurrent consent forms and overlapping YNAB callbacks.

**Left off at**: Deployed Cloudflare Worker version `fb1cb3da-2aae-49ca-9ef1-02ee2efb7d07`. A live two-client production probe held two CSRF cookies simultaneously, received two independent 302 redirects to YNAB, held two state cookies simultaneously, and validated and cleared both callback states. Offline checks passed with 28 core tests, 16 Worker tests, the safety suite, 62-tool discovery, release consistency, and a Wrangler dry run.

**Open questions**: Repeat signed-in, read-only acceptance from fresh connector flows in Claude.ai and Mistral Work. Previously opened consent pages use the old global cookie names and must be restarted from the MCP client. Write and undo acceptance still requires explicit approval for the exact write operation.

---

## 2026-07-15 - Hosted connector identity and sanctioned YNAB mark

**What changed**: Finished the Cloudflare connector identity work on top of the v5.1.0 hosted OAuth release. The Worker now advertises `MCP Server for YNAB`, the canonical `https://ynab.amesvt.com/mcp` resource, and HTTPS PNG and SVG icons in its MCP `initialize` response. It serves YNAB's unmodified, expressly permitted “Works with YNAB” integration mark as SVG, a 196x78 PNG rendering for clients that require PNG, and matching favicon routes. The landing, consent, privacy, deletion, and error pages display the mark and YNAB's required non-affiliation and trademark notice. A future Claude Connectors Directory submission draft was added, but nothing was submitted or published to a directory.

**Decisions made**: Used only the integration mark linked from YNAB's API Terms. Did not use YNAB's consumer app icon or other brand art because the terms do not generally license those assets. Kept the PNG first in MCP icon metadata because MCP clients must support PNG and only should support SVG. Published all same-origin icon and favicon discovery paths because custom connector clients may ignore `serverInfo.icons` or cache favicons; the UI is therefore an external acceptance check, not something the server can force. The Cloudflare implementation remains separate from Glama.

**Left off at**: Deployed Cloudflare Worker version `3a00f10f-1c39-4985-8d98-f11a7978af6a`. Live checks returned 200 for the landing page, protected-resource metadata, PNG, SVG, and favicon routes; the PNG SHA-256 is `62acc564199716bf07bcc2255c9500c5fb405d5904977f90993ec4dcd83487ba` and the SVG SHA-256 is `4bcf864d8712607afdf48eec28a30562e37d9f28b5478744429fea4dcdf1094f`. Conditional asset requests returned 304. Offline verification passed with 28 core tests, 14 Worker tests, the safety suite, 62-tool MCP discovery, release consistency, a Wrangler dry run, and an in-memory MCP handshake that returned the connector title and both icons.

**Open questions**: NEW: complete user-authorized acceptance in Claude.ai and Mistral Work using connector name `MCP Server for YNAB` and URL `https://ynab.amesvt.com/mcp`, then confirm OAuth, tool discovery, a read-only call, and what icon each client actually renders. Still open from v5.1.0: test write access and undo only after explicit approval. A public Claude Directory submission remains intentionally deferred pending Oliver's explicit approval, appropriate organization access, reviewer credentials, and YNAB Restricted Mode review planning.

---

## 2026-07-15 - v5.1.0: hosted OAuth connector live at ynab.amesvt.com

**What changed**: Finished and hardened the Cloudflare-hosted connector at `https://ynab.amesvt.com/mcp`. The hosted Worker now reuses the full local MCP factory, supports Streamable HTTP and legacy SSE, registers clients dynamically, and signs each user in through YNAB's authorization-code flow. The security pass added S256-only PKCE, a fixed production callback origin, opaque one-time consent records, CSRF protection for consent and deletion, HTML escaping and strict response headers, separate AES-GCM encryption for YNAB tokens and undo journals, refresh-race handling, transactional rollback around connector authorization, and complete paginated grant revocation. CI and the release workflow now test and bundle the Worker. The README and hosted-connector docs now describe the live endpoint, privacy policy, deletion flow, and exact production configuration. The release script runs all local and Worker gates before changing version files, preventing the prior double-bump failure mode.

**Decisions made**: Kept one endpoint with a read-only default and explicit write opt-in. YNAB tokens remain server-side; MCP clients receive only connector-scoped tokens. OAuth provider grants and clients share the existing `OAUTH_KV` namespace, while YNAB credentials and undo entries receive a second application-encryption layer using a dedicated `DATA_ENCRYPTION_KEY`. Failed refreshes preserve the prior record and re-read for a concurrent successful rotation because Cloudflare KV has no compare-and-swap. Callback and consent state are single-use with a 10-minute TTL. The initial YNAB application's Restricted Mode is sufficient for private testing before any public listing review.

**Left off at**: Published `@oliverames/mcp-server-for-ynab@5.1.0` to npm and deployed Cloudflare Worker version `835aa177-ce67-43b0-8709-24f6f44e8481` on the `ynab.amesvt.com` custom domain. Live checks passed for DNS/TLS, public pages, OAuth and protected-resource metadata, unauthenticated MCP challenge behavior, dynamic registration, escaped consent, CSP, CSRF, one-time consent, fixed callback URI, YNAB PKCE, and read-only scope. Offline checks passed with 28 core tests, 11 Worker tests, the safety suite, a 62-tool MCP discovery smoke, release consistency, and a Wrangler bundle/schema dry run. The temporary smoke client and OAuth state were removed from KV.

**Open questions**: The only remaining external check is a full user-authorized MCP call. Add `https://ynab.amesvt.com/mcp` in claude.ai again, complete YNAB consent, then list tools and run a read-only request before testing writes. The earlier Safari error was a stale local Tailscale DNS NXDOMAIN; toggling Tailscale DNS off and back on restored normal resolution, and public resolvers plus normal `curl` now reach the Worker.

---

## 2026-07-14 - v5.0.0: workflow layer, undo journal, analytics, prompts/resources, Glama readiness

**What changed**: Major release adopting the best features from a survey of all 19 YNAB MCP servers on Glama plus Glama's hosting/scoring docs. (1) **Category workflows**: `merge_category`, `retire_category` (the API has no category merge/delete; these move transactions + budgets and report the manual UI step), and `prepare_split_for_matching` (dgalarza pattern — mirror unapproved split for UI matching, since the API can't split imported transactions). (2) **Read-only audits**: `audit_credit_card_payments` (card balance vs payment-category funding) and `audit_account_reconciliation` (open-items list since last reconciliation). (3) **Analytics**: `get_budget_health` (green/yellow/red), `get_income_expense_summary` (savings rate, transfers excluded), `detect_recurring_charges` (payee+amount+cadence, annualized cost), `export_transactions` (CSV). (4) **Undo journal**: every transaction write journaled to `~/.ynab-mcp-undo.json` with before-state (captured pre-write; one bounded list request for batches); `list_undo_history` + `undo_operation` (restore fields / delete created / recreate deleted). (5) **6 MCP prompts + 4 `ynab://guide/*` resources** distilling general knowledge from the ynab-finance skill (methodology, write safety, audit patterns, flags reference — no personal data). (6) Rate-budget warnings appended to responses at ≤50 requests remaining in the trailing hour. (7) **TDQS description sweep**: every one-line tool description rewritten with purpose/usage/side-effects (Glama scores 60% mean + 40% minimum across tools). (8) **Glama**: root `glama.json`, listing claimed (verified badge), README Glama Hosting section; `YNAB_OP_PATH` now reports a clear "op CLI not installed" message on ENOENT (containers). Tool count 47 → 58 with writes; unit tests 21 → 28. Verified: unit + safety + smoke suites, 30/30 release-consistency checks, npm registry check, CI + Release workflows green. README hero/examples refreshed per readme-style.

**Decisions made**: Version is **5.0.0, not 4.0.0** — publish.sh writes the bump before its checks run, so a failed run + rerun double-bumped; npm versions are immutable, kept 5.0.0 (gotcha saved to memory). Deliberately NOT adopted: milliunit dual-amount params (dollars-everywhere is cleaner), klauern's Code Mode (ynab_tool_index/execute covers it), OAuth (PAT + gateway auth suffices for the private deployment). `delete_category` named `retire_category` for honesty. Repo rename to `mcp-server-for-ynab` deferred — see issue #5 (Glama slug migration risk while listing is freshly claimed; plugin-ID rename would orphan installs).

**Left off at**: Glama hosted deployment is one step from done: Oliver must add a payment method (hosting is metered; deploy flow is gated on it), then MCP Deployments → Browse & Deploy → set env vars per the Desktop guide ("Glama Deployment Guide - YNAB MCP Server.md") — `YNAB_API_TOKEN` must be pasted by Oliver. Glama's scanner last processed 3.1.0; 5.0.0 release should appear on next sync. Future track: Smirnovlabs-style multi-user OAuth connector on Oliver's Cloudflare account under amesvt.com (see docs/hosted-oauth-connector.md and project memory).

**Open questions**: Does Glama's rescan pick up 5.0.0 cleanly (Dockerfile admin config uses pnpm/mcp-proxy — predates this session)? Live smoke of the new audit/analytics tools against the real budget not yet run (offline suites only). Carried forward: `get_month` ~$94K Inflow balance diagnosis; Docker image untested in CI; Gmail draft to Dela (name choice + ToS #6) — note the proposed "Local MCP Server for YNAB" name intersects the deferred repo rename in issue #5.

---

## 2026-07-05 - v3.2.0: full API parameter coverage, single-request batch verification, response-size hardening

**What changed**: Full audit against the live YNAB OpenAPI spec (v1.85.0) plus a deep review pass. (1) **API coverage completed at the parameter level** — endpoint coverage was already 100%; added the missing parameters: `list_budgets` gains `includeAccounts` (GET /plans?include_accounts), `get_budget` gains `lastKnowledgeOfServer` for full/delta budget exports (returns `{ budget, server_knowledge }` with all entities dollarized), `update_transaction`/`update_transactions` gain `subtransactions` (convert a non-split into a split), and `update_transactions` entries can be addressed by `importId` instead of `id` (exactly one required; ambiguous import_id matches are detected and refused since YNAB import_ids are only unique per account). Spec-derived `.max(200)` payee-name and `.max(500)` payee-rename limits added. (2) **Batch verification no longer N+1** — `update_transactions`/`approve_transactions`/`reassign_payee_transactions` verification refetches the whole batch in one bounded list request (90-day window, per-transaction GET fallback for stragglers, bulk retry PATCH for mismatches) instead of one GET per transaction, which was burning the shared ~190 req/hour budget (a 100-row approval cost 100 extra requests, ~30 min of rate-limiter stalls). (3) **Response-size cap now covers SDK calls** — `MAX_RESPONSE_BYTES` was only enforced in `ynabFetch`; `secureFetch` now caps the decoded body for every request path (header pre-check + streamed body cap), closing the gap where SDK-mediated responses (including full budget exports) were unbounded. (4) **SDK wiring assertion** — the `api._configuration.config` setter hack is now verified at startup via the public `Configuration.fetchApi` getter; the server refuses to start if host pinning/rate limiting/retries would silently not apply. (5) Fatal `uncaughtException`/`unhandledRejection` logs are token-redacted. (6) `test.js` exits with a clear SKIP message when no credentials are configured instead of a confusing TypeError. (7) **Dockerfile + .dockerignore** added (fixes the Glama registry build failure from 2026-06-04; container runs stdio MCP as non-root). (8) Dedup helpers: `formatBudgetSummary`, `formatMonth`, `formatSubtransaction`, `formatScheduledSubtransaction`, `mapSubtransactions`, shared `subtransactionInputSchema`. (9) Docs refreshed: README (new params, Docker, verification behavior, rate-budget notes), `docs/openapi-spec.yaml` synced to live spec. Offline unit tests grew 17 → 21, including a mocked-fetch regression test proving batch verification issues exactly one list request.

**Decisions made**: Minor bump (3.1.0 → 3.2.0): additive surface, no breaking changes. No new tools — coverage gaps were parameter-level, so tool count stays 47-with-writes. Verification stays server-refetch-based (PATCH responses alone are not trusted) but is bounded and batched. Gmail: YNAB's Works-with-YNAB review (Dela, 2026-06-22) asks for an app-name change ("MCP for YNAB" collision) and a ToS #6 acknowledgment — drafted a reply (Gmail draft, not sent) proposing "Local MCP Server for YNAB"; the final name is the owner's call before sending.

**Left off at**: Branch `claude/ynab-api-coverage-review-5g9gty` pushed with draft PR. After merge: `npm version` artifacts are already synced; tag v3.2.0 to trigger the release workflow, then `npm publish` + `release:check:registry`.

**Open questions**: Owner to review/send the Gmail draft to Dela (name choice + ToS #6). Docker image untested in CI (no daemon in the dev sandbox) — consider a CI job that builds the image. Carried forward: `get_month` ~$94K Inflow balance diagnosis; npm automation token in 1Password.

---

## 2026-07-02 - v3.1.0: repair release tooling, reliability hardening, offline tests, CI

**What changed**: Comprehensive review pass over the whole repo. (1) **Release tooling was broken**: `release:check` and `sync:plugin` still read the root `.codex-plugin/` that the 2026-06-22 session moved to `codex/.codex-plugin/`, so both crashed with ENOENT — fixed the paths, added a regression assert that the Codex marketplace `source.path` stays `./codex`, and fixed the stale README host-table paths. (2) **review_unapproved missed old stragglers**: the unapproved fetch omitted `since_date`, which YNAB now defaults to one year ago, so unapproved transactions older than a year were invisible to review while `approve_transactions` (which fetches full history) could still act on them — review now fetches full history too. (3) **HTTP retries**: `secureFetch` now retries HTTP 429 for any method (YNAB rejects 429s before processing) honoring `Retry-After`, and retries 502/503/504 + network errors for reads only, capped by new `YNAB_HTTP_RETRIES` (default 2). (4) **NaN env guards**: mistyped numeric env vars (e.g. `YNAB_RATE_LIMIT_BURST=ten`) previously produced NaN — in the burst case a busy infinite loop in the rate limiter — all numeric env parsing now goes through `envNumber()` with fallbacks. (5) **Executor validation**: `ynab_tool_execute` / `ynab_write_tool_execute` passed raw JSON to handlers, bypassing zod; they now validate against the target tool's schema and return descriptive errors. (6) Added `unhandledRejection` handler. (7) **Offline unit tests** (`npm run test:unit`, 17 tests) via new helper exports and a `YNAB_MCP_NO_AUTOSTART=1` guard. (8) **CI + release automation**: `.github/workflows/ci.yml` (Node 18/20/22: syntax, unit, safety, release:check, credential-free smoke) and `.github/workflows/release.yml` (tag push → verify tag/version, test, build MCPB, publish GitHub release). (9) Removed committed `.a5c/` session artifacts and gitignored the directory.

**Decisions made**: Minor bump (3.0.0 → 3.1.0): behavior additions and fixes, no breaking surface change. Write retries limited to 429 because a timed-out POST may have applied server-side. Executor validation is non-strict (unknown keys stripped) for parity with direct SDK-validated calls. Did NOT run the live `npm test` — it writes to the owner's real budget and no credentials exist in this environment; offline suites (`test:unit`, `test:safety`, smoke list-tools) all pass.

**Left off at**: Branch `claude/app-review-improvements-vvbdt7` pushed with PR; v3.1.0 tag/release created via the new release workflow. npm publish still pending owner auth (`npm publish` after merge; then `release:check:registry`).

**Open questions**: Carried forward: `get_month` ~$94K Inflow balance diagnosis; split-transaction tool-description audit; npm automation token in 1Password.

---

## 2026-06-22 - Fix Codex plugin resolution + wire credentials

**What changed**: Codex was dropping the `ynab-mcp-server` marketplace entirely (`codex plugin list` showed zero plugins under it; `codex plugin add` returned "plugin not found"), so YNAB was non-functional in Codex. Root cause: `.agents/plugins/marketplace.json` declared the plugin `source.path` as `"./"` (the marketplace root), which Codex cannot resolve. Moved the Codex plugin into a `codex/` subdirectory and repointed the source to `./codex` (`f1a1d83`). Then replaced a dead `env_vars` passthrough with `${VAR}` substitution in the Codex MCP `env`, which Codex resolves from `[shell_environment_policy.set]` (`f54ccb9`).

**Decisions made**: Confirmed the subdir requirement with a throwaway local-marketplace probe before touching the repo. Left Claude (`.claude-plugin`, source `"./"`, which works there), Antigravity, and Hermes packaging untouched. Verified the YNAB token against the live API (HTTP 200).

**Left off at**: `ynab-mcp-server@ynab-mcp-server` now resolves as `installed, enabled 3.0.0` in Codex (enabled-plugin count 43 -> 44). A Codex restart is needed to spawn the server from the refreshed snapshot.

**Open questions**: If a YNAB call errors in Codex, confirm `[shell_environment_policy]` env actually propagates to MCP subprocesses on the current Codex build.

---

## 2026-06-18 - Standalone YNAB marketplace replaces ames-connectors

**What changed**: Made this repo a standalone plugin marketplace for `ynab-mcp-server` so YNAB no longer depends on the older `ames-connectors` marketplace. Added Claude Code and Codex marketplace/plugin metadata, then added Hermes and Antigravity manifests using the existing host-specific shapes: Claude uses `.claude-plugin/marketplace.json` plus `.mcp.json`, Codex uses `.agents/plugins/marketplace.json` plus `.codex-plugin/mcp.json`, Hermes uses a flat `.hermes-plugin/mcp.json`, and Antigravity uses `.antigravity-plugin/mcp_config.json`. Updated `scripts/sync-plugin-metadata.mjs` and `scripts/check-release-consistency.mjs` so future version bumps and release checks cover all four hosts.

**Decisions made**: Treat `ynab-mcp-server` as the active standalone YNAB marketplace and `ames-connectors` as sunsetted for YNAB. Kept the plugin install behavior aligned with the old `ames-ynab` connector by setting `YNAB_ALLOW_WRITES=1` in plugin MCP configs, while direct MCP registration remains read-only unless writes are explicitly enabled. Did not edit protected host configs or caches during this wrap-up; the repo is the source of truth, and host cleanup should happen as a separate confirmed task.

**Verification**: `npm run sync:plugin`, `npm run release:check`, `npm run test:safety`, `npm test`, `claude plugin validate .`, `npm pack --dry-run`, and `git diff --check` all passed. After push, `origin/main` matched local HEAD `0ee01573f014874ef31f48a8298d66f7262c4871`.

**Left off at**: Commits `64a7263`, `6ed7467`, and `0ee0157` are pushed to `main`. The user confirmed in the plugin directory UI that `ynab-mcp-server` now appears as its own Personal marketplace with the `YNAB MCP` plugin card.

**Open questions**: NEW residual drift - safe preflight still sees `ames-connectors` and `ames-ynab@ames-connectors` in Claude settings metadata. Clean those protected host references only after explicit confirmation, since the repo work is complete and the UI replacement was already performed manually.

---

## 2026-06-01 - v2.1.0 released to GitHub (MCPB); group-total rounding fix

**What changed**: Authored the first GitHub release of v2.1.0 — the 2026-05-29 session bumped to 2.1.0 but never tagged or released it, and npm `@latest` is still 1.7.1 (publishing blocked on npm-auth recovery). Also fixed group-total float drift: added a `round2()` helper beside `dollars()`/`milliunits()` and applied it at the three sites that summed amounts with raw `reduce`/`+=` — `review_unapproved` ready_to_approve group totals, needs_category_first by-payee totals, and `get_overspent_categories` total_overspent — eliminating IEEE-754 artifacts like `-53.730000000000004`.

**Decisions made**: Folded the round2 fix into the still-unreleased 2.1.0 rather than bumping to 2.1.1 — nothing ever consumed 2.1.0 (no tag, no release, no npm), so package.json/index.js/README stay consistent with zero churn. Rounded once at each final total (not per `+=`) to avoid compounding. Authored an annotated **unsigned** tag + `gh release create` (1Password SSH signing can't prompt from a headless shell; signing bypass was owner-authorized this session).

**Verification**: `node --check` clean; `round2` unit cases incl. the `-53.73...` artifact + null passthrough; `smoke:list-tools` (28 read-only tools; 47 with `YNAB_ALLOW_WRITES=1`); `release:check` all PASS at 2.1.0. Rebuilt the MCPB with `--force` and confirmed `round2` is present in the bundle's root `index.js` (4 occurrences) before tagging. Release is live + marked Latest with `ynab-mcp-server-2.1.0.mcpb` (6.24 MB) attached: https://github.com/oliverames/ynab-mcp-server/releases/tag/v2.1.0 . HEAD d91696e == origin/main, clean.

**Left off at**: v2.1.0 released on GitHub; npm publish still pending npm-auth recovery (owner working on it — then npm `@latest` catches up from 1.7.1).

**Open questions**: NEW deferred feature — a dead-link resolver for `match_broken` (resolve `matched_transaction_id`; flag orphan vs live-duplicate). Scoped but intentionally NOT built until npm publish unblocks, so it can be integration-tested against the live server; the manual `get_transaction(matched_transaction_id)` method works meanwhile and is now documented in the ynab-finance skill. Carried forward: npm auth for `npm publish`; split-transaction tool-description audit.

---

## 2026-05-29 - Categorization-session ergonomics: compact queue, summary writes, bulk-approve, payee reassign

**What changed**: Four source additions to `index.js`, all driven by friction observed during a live ~90-transaction YNAB categorization + approval session run through the hosted connector:
- `review_unapproved` gains `compact: true` — keeps per-transaction rows (id, date, payee_name, amount, category_name, account_name, flags) but drops bulky fields (import strings, subtransactions, matched/import ids). The full (non-summary) response reliably overflowed the client's inline result limit (84KB at 69 txns, 111KB at 89), forcing save-to-file + Python parsing every call. `summary` lacked IDs; this is the missing middle gear.
- `update_transactions` gains `returnSummary: true` — returns `{updated_count, approved_count, verification: {checked, retried, failed}}` instead of full objects. A 64-transaction approval returned 57KB and overflowed; callers usually only need confirmation counts.
- `approve_transactions` (new write tool) — approve unapproved transactions in bulk by filter (`payeeId`/`categoryId`/`accountId`) without hand-listing IDs. Skips uncategorized by default. Eliminates the build-a-64-ID-batch-in-Python step (which the skill itself warns against: "never type IDs by hand").
- `reassign_payee_transactions` (new write tool) — moves all transactions from payee A to B. This is the *merge workaround*: the YNAB API has **no** payee delete or merge endpoint (only `PATCH …/payees/{id}` rename), so duplicate payees from slightly different import strings (e.g. "Myles Court Barber" vs existing "Myles Court Barbershop") otherwise require manual UI cleanup.

**Decisions made**: Chose a reassign helper over a "merge_payees" tool because the YNAB API cannot delete/merge payees — the source payee stays and must be removed in the UI. Did NOT touch the `get_month` Inflow-category balance (it reported $94K alongside a $4K `to_be_budgeted` and read as misleading) — root cause was never diagnosed this session, so suppressing it risked hiding real data; left as an open question. Both new write tools are registered in `WRITE_TOOL_METADATA` so they stay hidden unless `YNAB_ALLOW_WRITES=1`, consistent with the v2.0.0 safety model.

**Verification**: `node --check index.js` clean. Booted the edited server over stdio with `YNAB_ALLOW_WRITES=1` and `listTools()` — 47 tools (was 45), both new tools present, and `review_unapproved.compact` / `update_transactions.returnSummary` params confirmed in the schemas. Did NOT run `npm test` — it performs live writes against the real budget (`YNAB_ALLOW_WRITES=1`), inappropriate to run unprompted on the owner's actual financial data. The matching skill-doc fixes shipped separately in the ames-plugins repo.

**Left off at**: Source committed to `main` (no version bump). These features sit on top of the still-unpublished v2.0.0, so the `v2.0.0` git tag no longer matches the tree — the next release must be **> 2.0.0** (suggest 2.1.0). Pending owner go-ahead: bump version, refresh README tool count (45→47) + `release:check`, rebuild the `.mcpb`, run `npm test` against a test budget, then publish (still blocked on the npm-auth issue from the prior entry). None of these propagate to the live connector until republish + client reinstall.

**Open questions**: Why does `get_month` report a ~$94K Inflow balance vs a $4K `to_be_budgeted` — data artifact, or a real accumulated RTA the field is surfacing? Diagnose before any relabel. Carried forward: npm auth for publishing; split-transaction tool-description audit.

---

## 2026-05-28 - v2.0.0 publish attempt: release verified, blocked on npm auth

**What changed**: No repo code changes. Ran the full v2.0.0 release verification on top of the morning's safety-hardening prep (entry below): `npm run release:check` PASS (lockfile, in-file McpServer version, README 45-tool count + v2.0.0 links + MCPB refs all consistent); `npm test` 41 passed / 0 failed / 4 skipped against the live budget; `npm run test:safety` passed; `npm publish --dry-run` clean (13 files, 808 kB, dominated by the 777 kB `assets/icon.png`). Confirmed registry state: 2.0.0 is unpublished, npm `latest` is 1.7.1, and 1.8.0–1.8.3 were tagged in git but never published (npm is 4 releases behind). Confirmed git: local `main` == `origin/main`, and the annotated `v2.0.0` tag is already pushed pointing at HEAD `48a3651` (the `git ls-remote` SHA `c37be21` is the annotated-tag object, which dereferences to `48a3651` — not a divergence).

**Diagnosed the blocker**: `npm whoami` returns 401 both via `~/.npmrc` and via the vaulted "npm Registry Auth Token (npmrc)" token tested in isolation — so the publish token is genuinely expired/revoked, not an `.npmrc` resolution glitch. The on-disk and vaulted tokens are identical and both dead, confirming the morning entry's note.

**Decisions made**: Did NOT publish (no valid auth). Did NOT modify the repo source — v2.0.0 is already correct and committed. Cross-repo credential hygiene this session (not ynab files): vaulted the second active AssemblyAI key as a new 1Password item and re-synced the stale Google Workspace OAuth secret in `~/.codex/config.toml` from the vault; both verified. Relevant here only because the npm-token diagnosis came out of that audit.

**Left off at**: v2.0.0 is fully verified and release-ready; the only blocker is npm auth. To resume: (1) `npm login` (writes a fresh token to `~/.npmrc`); (2) `npm whoami` to confirm; (3) `npm publish` (→ latest, public); (4) `npm view @oliverames/ynab-mcp-server@2.0.0` to verify; (5) mirror the new `~/.npmrc` token into the 1Password item `rtpscmu723e6ccmdj37e2qcthu` so the vault stops being stale. No git tag step needed — `v2.0.0` is already on the remote.

**Open questions**: NEW — consider a granular npm automation token stored in 1Password (vs an `npm login` web token) so future publishes can run non-interactively; the stale-vault-token failure mode argues for a pre-release `npm whoami` check in the release flow. Carried forward (still open): split-transaction tool-description audit; whether `get_transaction` should try `matched_transaction_id` as a third lookup; verify YNAB SDK v2.6+ for a clear-match endpoint.

---

## 2026-05-28 - v2.0.0: read-only default, safety hardening, hosted OAuth pattern

**What changed**: Borrowed the core safety model from read-only-first YNAB MCP implementations. The server now registers only read tools by default; tools that create, update, import, or delete YNAB data are hidden unless `YNAB_ALLOW_WRITES=1` is set at process startup. Tool metadata now annotates reads with `readOnlyHint: true`, writes with `readOnlyHint: false`, and delete tools with `destructiveHint: true`. Added a safety regression test for the default/read-write tool surface. Added host-pinned YNAB fetches, no redirect following, request timeout, token redaction in surfaced errors, client-side rate limiting, and `YNAB_API_TOKEN_FILE` fallback with a small-file guard. Smoke scripts now distinguish read-only and write-enabled surfaces, and the batch verification smoke refuses to run unless writes are explicitly enabled.

**Decisions made**: Bumped to v2.0.0 because hiding write tools by default is a breaking behavior change for existing write-heavy MCP configs. Kept the stdio package local-token based, but documented the hosted OAuth connector pattern separately: Cloudflare-style OAuth provider routes, PKCE, state-cookie binding, per-user YNAB token storage, refresh lifecycle, delete-data flow, and scope-aware write registration. A full hosted deployment still requires YNAB OAuth app credentials, a production hostname, and a token store.

**Left off at**: Safety tests, full live `npm test`, local read/write smoke checks, MCPB build, package dry-run, release consistency check, token-file startup smoke, and ames-plugins skill selftest pass. The highest-risk batch category+approval anomaly is covered by the existing post-write refetch verification and a write-enabled smoke script. npm publishing is blocked until a valid npm token with publish rights replaces the unauthorized `.npmrc`/1Password tokens.

---

## 2026-05-27 - v1.8.3: verified bulk category+approval updates

**What changed**: Hardened `update_transactions` against a live YNAB bulk API anomaly where `approved: true` persisted but `categoryId` did not. The tool now refetches every requested transaction after the bulk update, compares persisted fields against requested fields, retries mismatches once through `update_transaction`, and returns a `verification` block with `checked`, `retried`, and `failed` entries. If fields still do not match after retry, the tool returns an MCP error instead of silently reporting success. Added a live regression test that creates a temporary transaction, categorizes and approves it in a batch, refetches it, and asserts both fields persisted. Added `smoke:batch-verify` for the same stdio MCP path.

**Decisions made**: Verification runs for every batch update, not only category+approval batches, because the safety cost of a few refetches is lower than the cost of silent financial data drift. The response still keeps the existing `updated` array, but it now contains verified/refetched transactions rather than trusting the initial bulk response. README guidance now states that `review_unapproved` counts are not a sufficient post-write check and documents transfer-pair ID churn after manual YNAB UI conversion.

**Left off at**: package/server/README metadata target 1.8.3. The repo-side release can be cut after `npm test`, smoke scripts, MCPB build, and release checks pass. npm publishing remains dependent on a valid token with publish rights for `@oliverames/ynab-mcp-server`.

---

## 2026-05-27 - v1.8.2: smoke tests, release consistency, and MCPB release hygiene

**What changed**: Added first-class MCP smoke-test scripts for listing tools and calling `review_unapproved` in summary mode through the official MCP SDK `StdioClientTransport`. Added a release consistency checker that verifies `package.json`, `package-lock.json`, `index.js`, README release links, README MCPB artifact references, and optionally npm `latest` all agree. Added an MCPB build script that stages a clean production bundle, installs runtime dependencies, writes a versioned MCPB manifest, and refuses to overwrite an existing artifact unless `--force` is passed. README now documents the smoke-test/debug path and release checks, and release references point at v1.8.2.

**Decisions made**: Shipped this as patch v1.8.2 because the runtime API surface is unchanged; the fix is release/debug ergonomics and metadata consistency. Kept smoke output privacy-conscious by printing aggregate counts only for `review_unapproved`, not transaction details. Included `scripts/` and `assets/icon.png` in the npm package so published tarballs contain the documented debug helpers and MCPB asset source.

**Left off at**: package metadata, server metadata, README links, and MCPB manifest all target 1.8.2. The release validation path is `npm run release:check`, `npm run smoke:list-tools`, `npm run smoke:review-unapproved`, `npm run build:mcpb`, `npm pack --dry-run`, publish, then `npm run release:check:registry`.

---

## 2026-05-21 - Repair dependency bootstrap and mutable category test fixtures

**What changed**: Fixed the `npm test` startup failure where Node could not resolve `ajv/dist/ajv.js` through `@modelcontextprotocol/sdk`. The local `node_modules/ajv` tree had been partially corrupted, with expected entry files landing outside the real `dist/` directory, and the old `pretest` guard skipped reinstalling because `node_modules/` existed. `package.json` now probes the MCP SDK import and falls back to `npm ci --silent --no-audit --no-fund` when dependencies are missing or broken. `package-lock.json` now matches the already-shipped `1.8.1` root version. The live YNAB tests also now select only visible non-internal categories for mutable category and transaction-write fixtures, and the category note round-trip restores the original note instead of clearing it unconditionally.

**Decisions made**: Kept the bootstrap check targeted to the actual MCP SDK import rather than reinstalling on every test run. That catches the observed AJV resolution failure while keeping normal test runs faster. Did not bump the package version because this is a test/release-infrastructure repair for the existing `1.8.1` source state, not a server runtime behavior change.

**Left off at**: `npm test` passed locally against the live budget with 40 passed, 0 failed, and 4 skipped. The composite scheduled-transaction fallback branch was not exercised in this run because no composite scheduled-transaction IDs were present in the current unapproved queue.

**Open questions**: Still open from prior entries: consider an audit pass over tool descriptions for split-transaction limitations and any future YNAB SDK support for clearing matched-transaction links. Still open from v1.8.0: decide whether `get_transaction` should try `matched_transaction_id` as a third lookup for composite scheduled-transaction edge cases.

---

## 2026-05-18 — v1.8.1: review_unapproved description correction for match_broken

**What changed**: Corrected the `review_unapproved` tool description's `match_broken` flag explanation in index.js:1241. Prior wording — "CANNOT be fixed via this API, requires YNAB web/iOS UI" — conflated two distinct operations: clearing the stale `matched_transaction_id` field (which IS API-immutable — there's no schema input for it on `update_transaction`/`update_transactions`) versus approving, recategorizing, or editing the transaction (which is FULLY API-supported). The wording led at least one audit session to defer match_broken approvals to the web UI unnecessarily; surfaced 2026-05-18 during the May audit when an Apple Watch installment payment ($45.33) was held back from the approval batch despite the user having decoded what the charge was. Live API test confirmed `update_transaction({ approved: true })` succeeds on a match_broken transaction — only the `matched_transaction_id` link persists as a cosmetic flag. New description states: matched_transaction_id is the read-only field; the transaction itself remains fully mutable; broken match persists as cosmetic state until user resolves in UI.

**Decisions made**: Patch bump (1.8.0 → 1.8.1) — pure description fix, no behavior or schema change. Bumped both `package.json` and the in-file `McpServer` version (index.js:160) for consistency. Did not touch the underlying `flagTransaction()` detection logic at index.js:1281: that's still correct — match_broken is the right signal when `matched_transaction_id && !import_id`. Only the user-facing description needed correcting. Concurrent edits to ames-plugins/ames-standalone-skills/ynab-finance/{SKILL.md flags table, references/categorization-workflow.md handling section} replicate the corrected guidance for downstream consumers loading the skill directly — both reference layers (MCP tool description + skill text) needed updating because future sessions may consult either first. Also expanded categorization-workflow.md's "Splitting transactions" section to document the delete + recreate workaround (verified working live during the May audit on a $100 passport check → 2-way split between Henry and Emmett), and added a new "Common audit patterns" section to SKILL.md covering pending returns, manual entry for non-imported transactions (Venmo/checks), transfer-pair cleared-state diagnostic, and payee-category drift (Apple, City-of-X).

**Left off at**: index.js:1241 and index.js:160 updated. package.json bumped to 1.8.1. Skill files updated in `.claude/plugins/marketplaces/ames-plugins/plugins/ames-standalone-skills/skills/ynab-finance/`. WORKLOG entry added. Cache directories (`.claude/plugins/cache/...` and `.codex/plugins/cache/...`) NOT touched — those refresh on next plugin reload. package-lock.json NOT bumped — Oliver can sync with `npm install` before publishing.

**Open questions**: Should the description-correction pattern be applied audit-style across other tool descriptions? Specifically `update_transaction`/`update_transactions` could carry a brief note that `subtransactions` is NOT in their schemas — the convert-single-to-split workflow requires `delete_transaction` + `create_transaction` with subtransactions. The skill's `categorization-workflow.md` now documents this workaround; redundancy in the MCP tool description itself is debatable. Also: the `matched_transaction_id` could be exposed as a read-only return-side field (it already is, `formatTransaction` maps it through) — but there's no current need to expose a setter since the YNAB API doesn't accept one. Worth verifying with a YNAB SDK upgrade pass when v2.6+ ships in case the underlying API gains a clear-match endpoint.

---

## 2026-05-15 — v1.8.0: get_transaction falls back to scheduled template on stale composite IDs

**What changed**: `get_transaction` now handles a previously-broken edge case for composite scheduled-transaction IDs (the `uuid_YYYY-MM-DD` form returned in `transactions?type=unapproved` after a scheduled transaction realizes). When the composite ID's underlying matched real transaction has been deleted but the scheduled template is still active, the tool now falls back to `getScheduledTransactionById` and returns a wrapper shape with `resource_type: "scheduled_transaction"`, `reason: "composite_id_with_no_matched_transaction"`, the formatted scheduled transaction, and the original `requested_id`. Non-composite IDs preserve strict behavior — a 404 still surfaces as `resource_not_found`. Only HTTP 404s trigger the fallback; auth/rate-limit/network errors bubble up untouched. Both lookups returning 404 produces a descriptive error that names both attempts. Bumped the in-file `McpServer` version (was lagging at 1.6.0 since v1.6.0 ship) along with package.json + package-lock.json to 1.8.0.

**Decisions made**: Bumped to v1.8.0 (minor, not patch) because the response shape gains a new variant — callers branching on `resource_type` need to handle the scheduled-transaction wrapper. Existing happy-path callers see no change. Detect composite IDs from the original `transactionId` input (not the normalized form), since after `normalizeTransactionId` the date suffix is gone and the predicate would always be false. Re-throw a synthesized `{ error: { id, name, detail } }` plain object on the double-404 case to match the YNAB SDK's existing thrown-JSON convention (the SDK throws parsed response bodies via `throw await response.json()` at runtime.js:160 rather than Error instances) — that keeps the `run()` formatter in index.js working unchanged. Kept the `normalizeTransactionId` helper untouched per spec — it does one thing and the fallback logic belongs at the tool layer, not the normalizer. Added a single `get_transaction (composite ID)` test that branches on `resource_type` so it exercises whichever path the live budget happens to be in; logs a SKIP-style note when no composite IDs exist in the unapproved queue. Verified path 2 (fallback) live against the user's budget — the Apple Watch fixture (`d9e7c3c2-1067-4b4c-a784-9f6c7a58a8c1`) currently has a stale match, so `npm test` exercised the scheduled-transaction branch end-to-end against the YNAB API.

**Left off at**: index.js, test.js, package.json, package-lock.json, WORKLOG.md all updated. `npm test` passing locally (40 passed, 0 failed, 4 skipped — the fallback branch logged: `composite ID with stale match falls back to scheduled_transaction (d9e7c3c2-1067-4b4c-a784-9f6c7a58a8c1)`). Committed and pushed to origin/main. Not yet published to npm — user runs `./publish.sh` manually when ready.

**Open questions**: Should the fallback also try the `matched_transaction_id` from the unapproved-list entry as a third lookup before giving up? In the verified Apple Watch case both bare UUID and matched ID 404'd, but a different stale state (e.g., matched ID was renumbered server-side rather than deleted) might be recoverable that way. Probably YAGNI until a second instance shows up. Also: `get_scheduled_transaction` tool already exists — should we add a hint in the fallback-shape `reason` field pointing callers there for direct future lookups? Currently a caller seeing the wrapper has to know to use `scheduled_transaction.id` going forward.

---

## 2026-05-15 — v1.7.1: test infrastructure resilience + npm publish

**What changed**: Two test-infrastructure fixes driven by a `Scripts/publish` run that surfaced both a missing-deps failure and a stale-data flake. (1) `package.json` now defines a `pretest` script that runs `npm ci --silent --no-audit --no-fund` when `node_modules/` is absent. Since `node_modules/` is gitignored, the prior `npm test` immediately blew up with `Cannot find package '@modelcontextprotocol/sdk'` on any workspace that hadn't run `npm install` yet. The pretest is a no-op when deps are already installed. (2) The `get_transaction (single)` test in `test.js` now skips composite scheduled-transaction IDs (`uuid_YYYY-MM-DD`) when picking a target, falling through to the first real-transaction candidate. Reason: the user's budget currently has a stale composite-ID entry (Apple Watch scheduled-template realization, April 30) whose `matched_transaction_id` points at a now-deleted real transaction, so both the bare scheduled UUID and the matched ID return 404 — the test was failing on this edge-case data, not on broken logic. Real-transaction lookup still verified by the rest of the candidate pool.

**Decisions made**: Kept the test fix scoped to candidate selection rather than expanding `normalizeTransactionId`'s contract — the helper still does exactly one thing (strip date suffix), and the broader stale-match handling was spawned as a separate v1.8.0 follow-up. v1.7.0 was never published to npm: the failing test blocked the publish flow, and after the fix landed the version was bumped directly to 1.7.1 via `npm version patch` (rather than retrying 1.7.0). The published 1.7.1 tarball therefore contains all v1.7.0 changes (`summary` mode, tool description hardening) plus a fresh `package.json`; consumers upgrading from 1.6.0 → 1.7.1 see the full delta. The test fix happened concurrently in a parallel Claude Code session (commit `1351755`, identical diff) — both sessions converged on the same patch independently, which only worked because the working tree stayed clean; a divergent fix would have silently lost work.

**Left off at**: v1.7.1 committed, tagged, pushed (commits `1351755` and `e366a1f`), and published to npm (registry confirmed). Local `package.json` shows 1.7.1; next bump cycle starts from there. No other repos modified this session. Two follow-up chips spawned (still open): (a) systemic `npm ci` step in `Scripts/publish:143-150` to protect `imagerelay-mcp-server`, `sprout-mcp-server`, and any future node connector from the same dep-missing failure mode; (b) a v1.8.0 change in `index.js:837-848` that makes `get_transaction` fall back to `getScheduledTransactionById` on 404 for composite IDs, returning a marked `resource_type: "scheduled_transaction"` shape rather than bubbling `resource_not_found`. Both chips are queued for one-click spawn.

**Open questions**: Carried from v1.7.0, still open: (1) `summary: true` mode on `get_transactions` for the 75KB+ overflow class on long Work Expenses pulls; (2) `fields` filter to subset returned columns; (3) `.toFixed(2)` wrap on group totals to clean up IEEE-754 float drift like `-53.730000000000004`. New: (4) whether `normalizeTransactionId` should detect deleted matched transactions earlier — the v1.8.0 chip captures one approach (404 fallback), but an alternative would be `get_transactions`-side filtering of entries whose `matched_transaction_id` is non-resolvable. The chip's approach is cheaper.

---

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
