# Worklog

## 2026-10-29 - Verify npm delivery and recent-change checks

**What changed**: Verified the public npm registry serves version 6.1.1, matching the committed package version. Both full maintenance runs found this version already up to date. No new upload ran. The prior publication-pending status is resolved by the registry check.

**Decisions made**: Reused this session's passing `npm test` result: 262 offline unit tests, the safety-model checks and all seven synthetic agent fixtures, with zero failures. No source changed in this documentation update.

**Left off at**: The existing Worker deployment and rollback receipt remain as recorded below. Live integration tests and financial provider calls did not run; the synthetic fixtures use local data. The final full maintenance run passed all eight stages.

**Open questions**: Still open: Authenticated live-budget acceptance remains separate under #24 and #40.

---

## October 28, 2026: offline default test command

Fixed [#43](https://github.com/oliverames/ynab-mcp-server/issues/43): `npm test` now runs the existing offline unit, safety-model and synthetic agent checks. The live integration runner is available explicitly through `npm run test:live`, and the README distinguishes the two. The live runner and its exact-preview, interactive consent helper are unchanged; the earlier automated release check correctly refused writes rather than approving them.

The same 262 tests passed on Node 20.20.2 and 26.12.1; Node 20 also counts two support modules as test entries. The safety-model checks and all seven synthetic agent fixtures passed on each runtime. Credential fallback was disabled, credential references and Sentry DSN were blank, and no live financial API call ran. Existing noninteractive refusal and separate-consent regressions passed. Release consistency and whitespace checks passed. Version 6.1.1 remains prepared for publication during the final kitchensync; no package publication or Worker deployment ran for this repair.

## October 28, 2026: Hono adapter security patch

Prepared 6.1.1 with the existing Hono Node adapter overrides and both lockfiles raised to 2.1.5 for [GHSA-rmxm-3fg6-px4f](https://github.com/advisories/GHSA-rmxm-3fg6-px4f). The Node 20 minimum and other dependency versions remain unchanged, and the server and plugin version carriers agree.

Both full audits report zero vulnerabilities. All 44 scoped consent, transport, credential-cache and reporting tests pass on Node 20.20.2 and 26.12.1; 47 Worker auth/consent tests pass. Release consistency, Node 20 stdio enumeration and the Worker bundle dry run pass. Public npm delivery remains for final kitchensync. No live financial operation ran during these checks.

Deployed source `861a032` to the existing YNAB Worker as `16af328f-9333-4d0f-a8d1-2b2b380ad1a5` at 100% traffic, replacing rollback version `a97bd34d-bd9d-4200-aeed-ab9060a1f340`. The Ames Consulting account, existing resources, routes and variables were preserved, with no storage migration. Homepage and OAuth metadata return 200, unauthenticated MCP returns 401, hostile Origin returns 403, and the homepage security headers match the pre-deploy baseline. Authenticated live-budget acceptance remains separate under #24 and #40.

## Current guidance

- [README](README.md) covers client setup, tool behavior, write-safety settings and testing.
- [Hosted connector](docs/hosted-oauth-connector.md) and the [Worker guide](worker/README.md) explain OAuth hosting and deployment verification.
- [Write recovery](docs/write-recovery.md) records journal behavior and recovery limits. [API documentation](docs/api-documentation.md) retains provider constraints.
- [Contributing](CONTRIBUTING.md), [security policy](SECURITY.md) and [release reporting](.github/RELEASES.md) cover maintenance and verified delivery.
- [GitHub issues](https://github.com/oliverames/ynab-mcp-server/issues) track current implementation, account-control and diagnostic follow-ups.

The manual live test scripts remain intentional tools. Read the README's testing guidance and each script's prerequisites before running one against a budget; this cleanup used no credentials or live financial data. Historical setup and release notes remain dated evidence, while the linked guides describe current behavior.

## October 13, 2026: documentation cleanup

Preserved the complete previous worklog in the dated archive below, including the icon work, releases, prior audits and open questions. The current file now points to maintained guidance. Source, tests, dependencies and workflows are unchanged. No npm publication, Worker deployment or YNAB operation ran for this cleanup.

Later, [PR #39](https://github.com/oliverames/ynab-mcp-server/pull/39) corrected the README's old-hostname guidance to match the completed October 11 cutover. Clients still using the old hostname should add the current URL and reconnect; already migrated clients need no change. Documentation checks and all nine GitHub jobs passed before merging at `5ae8b40`. Those checks are dated merge evidence, not reruns for this worklog update. No financial operation or deployment ran.

## October 17, 2026: agents 0.28.1 and SDK override removal

Resolved [#30](https://github.com/oliverames/ynab-mcp-server/issues/30) in `3f29218`. The Worker now uses `agents ~0.28.1`, which peers `@modelcontextprotocol/sdk` 1.32.1, so the temporary override is gone. A test that read the old `partyserver` package now checks agents' own `getAgentByName` path instead.

Verification: root unit tests 240/240, safety and eval checks passed, Worker tests 60/60, `npm audit` reported 0 vulnerabilities in both packages, and all nine CI jobs passed (run 39060667124). Worker version `ade63bcc-cf12-4996-8b30-04185176fee7` is deployed at 100% and replaced `d3da76f6-9578-448c-b2d1-450fc78f586d`. Unauthenticated checks of `/`, `/mcp` and the OAuth metadata passed. No signed-in tool call ran against the new version; that remains [#24](https://github.com/oliverames/ynab-mcp-server/issues/24). If a reconnected client misbehaves, redeploy `d3da76f6`, which has no migration dependency.

## October 23, 2026: ip-address override and Worker redeploy

`9103ef4` raised the `ip-address` override to 10.7.4 in both packages, clearing the quadratic-time `Address6` zone parsing advisory and the `express-rate-limit` advisory that depended on it. Worker tests and the bundle dry run passed, `npm audit` reported 0 vulnerabilities in both packages, and CI passed. The root `npm test` is the live script, so it read the real budget: every read passed, and every write was refused by the consent gate with "No write was attempted." Worker version `b2aa17ce-1b56-4ccf-be83-b7f15071fa03` is deployed at 100% from `9103ef4` and replaced `ade63bcc-cf12-4996-8b30-04185176fee7`. Unauthenticated checks of `/`, `/mcp`, `Origin` handling, `/authorize` and the OAuth metadata matched the pre-deploy baseline, and a tail showed every request `ok` with no exceptions. Signed-in verification still belongs to [#24](https://github.com/oliverames/ynab-mcp-server/issues/24). If a reconnected client misbehaves, roll back to `ade63bcc`.

## October 25, 2026: durable hosted previews and 1Password token cache

[#40](https://github.com/oliverames/ynab-mcp-server/issues/40): hosted write previews moved from MCP session memory into the consent's `OAuthCredentials` Durable Object, because ChatGPT's connector gateway opens a new MCP session per tool call and every approved write failed with "Preview token is missing". A stored preview is a token hash, the plan fingerprint and the expiry, bound to the consent (user, client, credential) instead of the session. Claims read and delete in one Durable Object step, so previews stay single-use; the five-minute expiry, fresh-state fingerprint check and separate `confirmed: true` are unchanged. A consent keeps at most 100 previews, and `/remove` and user deletion clear them. Local stdio still uses the in-memory map. The public privacy page and hosted docs were updated. This needs a Worker deploy; it adds no Durable Object migration or binding.

[#25](https://github.com/oliverames/ynab-mcp-server/issues/25): `YNAB_OP_PATH` lookups are cached for 10 minutes in a mode-600 file under `$XDG_CACHE_HOME/ynab-mcp-server/` or `~/.cache/ynab-mcp-server/`, keyed by the SHA-256 of the `op://` reference, so concurrent MCP sessions prompt for 1Password once. `YNAB_OP_CACHE=0` turns it off, and it is off on Windows. This needs an npm release to reach users. No deploy, publish or YNAB operation ran for either change.

## October 26, 2026: optional Sentry error reporting

`2782bf1` added optional Sentry error reporting to the stdio server with `@sentry/node` 11.9.0, pinned exactly. It stays off unless `SENTRY_DSN` is set. `lib/instrument.mjs` is the first import in `index.js` and loads the SDK through a non-literal dynamic import, so users without a DSN never load it and the Worker bundle leaves it out; the bundle dry run confirmed no `@sentry/core` or OpenTelemetry code in it. Tool handler failures are reported with the tool name as a tag and never the arguments. `run()` catches handler errors, so the report goes through an `onToolError` option on `createYnabServer`, which only the stdio entry point passes. Every event keeps the error type, a fixed message, package-relative stack frames, and YNAB's error id and name. Messages, response bodies, breadcrumbs, user, request, extra data and the hostname are dropped. Default integrations, tracing and profiling are off. Fatal errors flush before exit, and SIGINT/SIGTERM flush only when reporting is on. The release is `mcp-server-for-ynab@<version>`, because Sentry discards release names that contain `/`.

`da301dc` followed a security review. Frame-shaped lines inside an error message can no longer become stack frames, frames that do not look like code locations are dropped, and Windows, UNC and file-URL paths are normalized before anything outside the package is cut to a basename.

Verification: root unit tests 262/262 (including the new `test/error-reporting.test.mjs`, which runs the real SDK against a loopback DSN), safety and eval checks, release check, discovery smoke, Worker tests 64/64 and the bundle dry run passed; `npm audit --omit=dev` reported 0 vulnerabilities. CI passed for `2782bf1`. A live run of the server with the real DSN and a deliberately invalid YNAB token (one read, HTTP 401, no write) produced Sentry events `8bb54ce84fd840f3a0347e9fcf42c02c`, `eadcc677fb0746c69488b0fa6097dc8a` and `9f15f1c708214beb91a52059308f6b1c`. The last one, from the reviewed code, carried no arguments, token, error text, user, IP address or home path. The first two events had a coarse city in `user.geo`, which Sentry derives from the connecting IP on its side; the third had none. Turning on the project's "Prevent Storing of IP Addresses" setting would remove it reliably. The Docker image was not rebuilt locally. No npm release or Worker deploy ran; this reaches users with the next npm release.

## October 26, 2026: Claude connector icon resolves through Google's favicon service

This settles the open question in the archived icon entries ("registrable-domain-only resolution" versus "a domain-keyed Claude icon cache"). Claude does not fetch connector icons from the server. Inspecting claude.ai's connectors page, in the Apple Core session that fixed its own connector icon, shows that it loads `https://www.google.com/s2/favicons?domain=<registrable domain>`: `applecore.app` for `mcp.applecore.app`, and `ames-ynab.link` here. Neither `serverInfo.icons` nor anything the Worker serves changes the icon directly. Google's cache is the only route. For `ames-ynab.link`, Google redirects to `t2.gstatic.com/faviconV2` and returns HTTP 404 with its default globe, while `applecore.app` returns 200. The site itself is fine: `/` and `/favicon.ico` return 200 to Googlebot and Google-Favicon user agents, and the page declares SVG, PNG and ICO icons. `robots.txt` was Cloudflare's managed content-signal file, with comments only and no rules or sitemap. The first guess was that Google had never indexed the domain; Search Console later disproved it (see below).

`b6ca988` makes the Worker serve `/robots.txt` (`User-agent: *`, `Allow: /`, `Sitemap: <canonical>/sitemap.xml`) and a `/sitemap.xml` that lists `/` and `/privacy`, both built from the canonical origin. Worker tests 65/65 passed. With Oliver's approval, Worker version `a97bd34d-bd9d-4200-aeed-ab9060a1f340` is deployed at 100% from `b6ca988` and replaced `179c7655-a1e8-4767-a9b1-006f72b23066` (roll back with `wrangler rollback 179c7655-a1e8-4767-a9b1-006f72b23066`). It also brings the reported server version to 6.1.0. Live `/robots.txt` and `/sitemap.xml` return 200 to a Googlebot user agent with exactly the Worker's bodies; the 68-byte robots file shows that the origin file replaces Cloudflare's managed content-signal text. `/`, `/favicon.ico`, `/privacy` and the OAuth metadata return 200, and unauthenticated `POST /mcp` returns 401, matching the baseline.

Search Console, the same day: the coordinating session added `ames-ynab.link` as a Domain property for oliverames@gmail.com and verified it through Cloudflare's one-time TXT authorization, which Oliver approved. It submitted `https://ames-ynab.link/sitemap.xml` (accepted, 2 pages discovered) and requested indexing of `/`. URL Inspection already reported `/` as "URL is on Google" and indexed, before any of this. So the root cause is not a missing search index. Google's favicon service keeps its own crawl and cache, separate from the search index, and an indexed page does not by itself give it an icon. The s2 lookup still returned 404 after the deploy and the Search Console work (re-checked at sizes 16, 64 and 256). Nothing on our side is known to be wrong, so the only remaining step is to wait for that service to refresh. robots.txt and the sitemap stay because they are correct and cost nothing, but no evidence shows that the favicon service reads them. To check, run `curl -sL -o /dev/null -w '%{http_code}\n' 'https://www.google.com/s2/favicons?domain=ames-ynab.link&sz=64'`, which returns 200 once Google has the icon. That re-check is tracked in [#42](https://github.com/oliverames/ynab-mcp-server/issues/42).

## October 23, 2026: security review

Reviewed the hosted OAuth and consent flow, encrypted credential storage, the preview-token write gate, token redaction and the workflows. No code defect was found. `4a7ef80` raised zod to 4.6.7 in both lockfiles for GHSA-mrhx-c7xc-m3w5 (high). GitHub updated that advisory at 18:26 UTC, after the morning's passing audit, so the next CI audit step would have failed. Root unit tests 240/240, safety and eval checks, release check, discovery smoke, Worker tests 60/60 and the bundle dry run passed; `npm audit --omit=dev` reports 0 vulnerabilities in both packages. Later, `f8cc573` raised body-parser from 2.3.0 to 2.4.0 (the root override and the Worker lock) for GHSA-27r3-jxmh-p828 (high), published at 20:53 UTC; it also moved content-type, iconv-lite and qs by a patch or minor each, and the same checks passed. The root live `npm test` did not run. The Worker is not redeployed, so the deployed bundle keeps the older zod until the next deploy.

The callback state is deliberately cookie-free (Mistral's embedded browser dropped cookies in July), so a YNAB sign-in link from someone else's flow still reaches the final confirmation page in the victim's browser. That page names the client, redirect and access level and needs a same-origin click; binding the flow to a browser cookie would close the gap at the cost of that client.

## October 25, 2026: signed-in smoke check for the hosted connector

Built the tooling for [#24](https://github.com/oliverames/ynab-mcp-server/issues/24) on Oliver's decision for a one-time consent token. `npm run smoke:hosted:consent` registers a public OAuth client with the Worker, sends Oliver through the consent page with a loopback redirect (`127.0.0.1`, any port, PKCE S256, `resource` set to the exact MCP URL, scope `read`) and stores the refresh token and client id in a 1Password API Credential item, "YNAB MCP hosted smoke token", in the Development vault. `npm run smoke:hosted` reads it, exchanges it, saves the rotated refresh token back, connects over Streamable HTTP with the bearer token (`scripts/lib/smoke-client.mjs`, `withHostedClient`), and asserts the server version, tool names and count, and the `instructions` text against `createYnabServer()` in the checkout, plus a 401 for an unauthenticated `POST /mcp`. It lists tools only; it calls none and makes no YNAB request.

Constraints worth knowing. The provider (`@cloudflare/workers-oauth-provider`, default `refreshTokenTTL` 720 hours) ends a grant 30 days after consent and rotation does not extend it, so "one-time" means roughly monthly; the check warns from day 25 and names the renewal command. The provider accepts the previous refresh token for one more exchange, so a failed write-back to 1Password only warns. A write-capable consent is refused and never stored.

Verification: `node --test test/hosted-smoke.test.mjs` passes 10/10 against a local mock connector (discovery, registration, PKCE, rotation, bearer-protected Streamable HTTP built on `createYnabServer`). The 1Password store was round-tripped live with a throwaway item that was then archived. A live probe against `https://ames-ynab.link` confirmed that dynamic registration accepts a loopback redirect, that two different loopback ports both reach the consent page, and that the consent page offers the write checkbox. The browser consent itself and a live `npm run smoke:hosted` need Oliver, so #24 stays open. No deploy, release or YNAB operation ran.

## October 25, 2026: 6.1.0 released and Worker redeployed

Oliver approved the release. `@oliverames/mcp-server-for-ynab` 6.1.0 is on npm (registry `latest` confirmed, `release:check:registry` passes) with the 10-minute 1Password token cache ([#25](https://github.com/oliverames/ynab-mcp-server/issues/25)) and the hosted durable-preview code ([#40](https://github.com/oliverames/ynab-mcp-server/issues/40)). The release ran through `publish.sh minor` (unit, safety, discovery, Worker tests, bundle dry run, release check, MCPB build, publish) and the version commit `076aa58` and tag `v6.1.0` were pushed afterwards, so the registry `gitHead` is the parent `ecd2647`; the package contents are identical.

The Worker was deployed from `ecd2647` as version `179c7655-a1e8-4767-a9b1-006f72b23066`, replacing `b2aa17ce-1b56-4ccf-be83-b7f15071fa03` (roll back with `wrangler rollback b2aa17ce-1b56-4ccf-be83-b7f15071fa03`). It carries the durable previews and fast-uri 4.2.3 and adds no binding or migration. Unauthenticated checks of `/`, both OAuth metadata documents, `POST /mcp` (401) and a hostile `Origin` (403) match the pre-deploy baseline. The Worker still reports its server version as 6.0.1 until the next deploy from `076aa58`. A signed-in smoke and a real session-per-call write were not run: the "YNAB MCP hosted smoke token" item does not exist yet, so #24 and the ChatGPT write check in #40 remain open. The GitHub Release workflow for `v6.1.0` failed at `npm ci --prefix worker` (lock file out of sync with npm on the runner: "Missing: undici@7.29.1"), so no GitHub release or MCPB bundle exists yet.

## Historical record

The [complete worklog through October 13, 2026](WORKLOG-2026-10-13.md) is an exact copy of the previous file. It stays at the repository root to preserve each relative link's original context. The [preservation record](docs/archive/worklog-2026-10-13.json) records the source revision, byte count and SHA-256 digest.

<details>
<summary>Previous entry links</summary>

- [Worklog](WORKLOG-2026-10-13.md#worklog)
<a id="2026-10-11---vector-and-high-resolution-connector-icons"></a>
- [2026-10-11 - Vector and high-resolution connector icons](WORKLOG-2026-10-13.md#2026-10-11---vector-and-high-resolution-connector-icons)
<a id="2026-10-11---hosted-landing-page-setup-guide"></a>
- [2026-10-11 - Hosted landing page setup guide](WORKLOG-2026-10-13.md#2026-10-11---hosted-landing-page-setup-guide)
<a id="2026-10-11---approved-hosted-cutover-deployed"></a>
- [2026-10-11 - Approved hosted cutover deployed](WORKLOG-2026-10-13.md#2026-10-11---approved-hosted-cutover-deployed)
<a id="2026-10-11---prepare-hosted-domain-migration"></a>
- [2026-10-11 - Prepare hosted domain migration](WORKLOG-2026-10-13.md#2026-10-11---prepare-hosted-domain-migration)
<a id="2026-10-09---correct-worker-bootstrap-for-601"></a>
- [2026-10-09 - Correct Worker bootstrap for 6.0.1](WORKLOG-2026-10-13.md#2026-10-09---correct-worker-bootstrap-for-601)
<a id="2026-10-09---prepare-approved-600-release-and-hosted-rollout"></a>
- [2026-10-09 - Prepare approved 6.0.0 release and hosted rollout](WORKLOG-2026-10-13.md#2026-10-09---prepare-approved-600-release-and-hosted-rollout)
<a id="2026-10-09---approved-isolation-write-safety-recovery-and-read-improvements"></a>
- [2026-10-09 - Approved isolation, write safety, recovery and read improvements](WORKLOG-2026-10-13.md#2026-10-09---approved-isolation-write-safety-recovery-and-read-improvements)
<a id="2026-10-08---patch-sharp-and-deploy-the-hosted-worker"></a>
- [2026-10-08 - Patch sharp and deploy the hosted Worker](WORKLOG-2026-10-13.md#2026-10-08---patch-sharp-and-deploy-the-hosted-worker)
<a id="2026-10-08---released-550-to-npm-and-githubmcpb"></a>
- [2026-10-08 - Released 5.5.0 to npm and GitHub/MCPB](WORKLOG-2026-10-13.md#2026-10-08---released-550-to-npm-and-githubmcpb)
<a id="2026-10-07---github-issue-review-closeout"></a>
- [2026-10-07 - GitHub Issue Review Closeout](WORKLOG-2026-10-13.md#2026-10-07---github-issue-review-closeout)
<a id="2026-10-07---readme-refresh-closeout"></a>
- [2026-10-07 - README Refresh Closeout](WORKLOG-2026-10-13.md#2026-10-07---readme-refresh-closeout)
<a id="2026-10-05---fix-main-ci-release-check-audit-and-merge-dependabot-26"></a>
- [2026-10-05 - Fix main CI (release check, audit) and merge Dependabot #26](WORKLOG-2026-10-13.md#2026-10-05---fix-main-ci-release-check-audit-and-merge-dependabot-26)
<a id="2026-09-24--smaller-tool-discovery-payload-23"></a>
- [2026-09-24 — smaller tool discovery payload (#23)](WORKLOG-2026-10-13.md#2026-09-24--smaller-tool-discovery-payload-23)
<a id="open-items"></a>
- [Open items](WORKLOG-2026-10-13.md#open-items)
<a id="2026-09-22---worklog-compaction-and-stale-dependabot-alert"></a>
- [2026-09-22 - Worklog compaction and stale Dependabot alert](WORKLOG-2026-10-13.md#2026-09-22---worklog-compaction-and-stale-dependabot-alert)
<a id="2026-09-14---audited-the-connector-against-ynab-api-186-and-the-claude-tool-surface"></a>
- [2026-09-14 - Audited the connector against YNAB API 1.86 and the Claude tool surface](WORKLOG-2026-10-13.md#2026-09-14---audited-the-connector-against-ynab-api-186-and-the-claude-tool-surface)
<a id="2026-09-14---added-transaction-search-and-a-transfer-convenience-from-a-live-triage"></a>
- [2026-09-14 - Added transaction search and a transfer convenience from a live triage](WORKLOG-2026-10-13.md#2026-09-14---added-transaction-search-and-a-transfer-convenience-from-a-live-triage)
<a id="2026-09-08---unblocked-non-browser-mcp-clients-at-the-cloudflare-edge"></a>
- [2026-09-08 - Unblocked non-browser MCP clients at the Cloudflare edge](WORKLOG-2026-10-13.md#2026-09-08---unblocked-non-browser-mcp-clients-at-the-cloudflare-edge)
<a id="2026-08-27---released-520-and-fixed-the-bundle-build-that-blocked-it"></a>
- [2026-08-27 - Released 5.2.0 and fixed the bundle build that blocked it](WORKLOG-2026-10-13.md#2026-08-27---released-520-and-fixed-the-bundle-build-that-blocked-it)
<a id="2026-08-26---reviewed-and-cleaned-up-an-uncommitted-work-in-progress-change"></a>
- [2026-08-26 - Reviewed and cleaned up an uncommitted work-in-progress change](WORKLOG-2026-10-13.md#2026-08-26---reviewed-and-cleaned-up-an-uncommitted-work-in-progress-change)
<a id="earlier-history-before-2026-08-23"></a>
- [Earlier history (before 2026-08-23)](WORKLOG-2026-10-13.md#earlier-history-before-2026-08-23)

</details>
