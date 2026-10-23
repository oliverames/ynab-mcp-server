# Worklog

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
