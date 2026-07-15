# YNAB audit delta: 2026-07-15

## Scope and status

This compares the original remote-connector audit with final production and
signed-in acceptance state at **2026-07-15 16:09 EDT (20:09Z)**. It omits
credentials, authorization codes, tokens, OAuth states, and personal budget
data.

- **Verified/closed:** supported by source plus tests, deployment/CI metadata, public probes, or direct host observation.
- **Inferred:** likely from verified chronology, but not directly demonstrated.
- **Pending:** requires a fresh host flow, approval, or external decision.

## Baseline-to-current delta

| Audit area | Original baseline | Current state | Status |
|---|---|---|---|
| Remote transport | Local stdio only | Cloudflare Streamable HTTP `/mcp` plus legacy `/sse` | Verified/closed |
| Shared behavior | Remote layer absent | Local and Worker use the same server factory, tools, schemas, prompts/resources, write gates, and undo semantics | Verified/closed |
| MCP auth/DCR | Missing | OAuth discovery, `/authorize`, `/token`, `/register`, S256-only PKCE, bearer challenge | Verified/closed |
| User auth | Owner PAT | Per-user YNAB authorization-code flow; host never receives YNAB tokens | Verified/closed |
| Least privilege | Local read-only default | Hosted read-only default coupled to YNAB and connector scopes; explicit write opt-in | Verified/closed |
| Embedded browsers | Cookie assumptions failed in live clients | Cookie-free server state, transactional Durable Object consumption, constrained Origin-less navigation | Verified/closed |
| Token lifecycle | No hosted vault | AES-GCM token/undo storage, refresh window, rotation-race recovery, guarded rollback | Verified/closed |
| Deletion/privacy | Hosted lifecycle missing | Public privacy/deletion; ownership proof; paginated grant revocation; token/undo deletion | Verified/closed |
| Network/HTML security | Hosted paths absent | Fixed HTTPS callback, host pinning, fail-closed redirects, escaping, CSP, anti-framing/no-store/nosniff | Verified/closed |
| Identity/icons | No remote identity | Connector metadata, permitted page mark, square discovery/favicon/social icon, and host-specific Mistral icon/description | Verified/closed for private use |
| Tests/release | No Worker gate | 21 Worker tests, 28 root unit tests, safety, 62-tool smoke, release checks, CI/security/dry run | Verified/closed |
| Production | No endpoint | Final Worker `e83324b1-277e-4cef-b068-e0f2b7b29525`; public 200/401 probes healthy | Verified/closed |
| Host acceptance | Not attempted | ChatGPT, Claude.ai, and Mistral Vibe Work each completed OAuth and a real budget-list read with writes enabled | Verified/closed |

## Closed security findings

1. **Concurrent/cookie state:** `7b2fee1`, `abca0e9`, `a37275b`, and `9900ed4` progressed from namespaced cookies to cookie-free, 192-bit HMAC-bound, 10-minute, transactionally consumed state with final confirmation and same-origin browser proofs. Replay, tamper, cross-flow, overlap, and concurrency tests pass.
2. **Hosted storage:** YNAB tokens, pending authorization, and undo entries are application-encrypted. Refresh preserves/re-reads records on rotation races. Failed grant persistence does not overwrite a newer concurrent record.
3. **Deletion:** Read-only YNAB sign-in proves ownership; all paginated grants are revoked before encrypted token/undo records are deleted; partial failure does not claim success.
4. **Write safety:** Hosted write tools require both explicit upstream choice and a write-enabled connector grant; shared destructive/bulk/generic confirmation gates remain in force.
5. **Public boundary:** Final probes returned 200 for landing and both OAuth documents, 401 plus correct resource metadata for unauthenticated MCP, and 200 plus expected digest for the icon.

## Production redirect incident

**Verified direct observation:** The first Mistral/Vibe Work flow reached connector consent, completed YNAB approval, and returned to the callback, which reported that redirect value `"error"` is unsupported and only `"follow"` or `"manual"` is accepted. No final connector grant was created.

**Verified root cause/fix:** Token exchange and `/v1/user` used `redirect: "error"`, which Cloudflare Workers rejects before upstream fetch. Commit `6c0f901c479f126011445192a45e6bc58b6ba64b` changed both to `manual` and rejects every redirect response before credentials can follow it. `30bca1c` then allowed only validated dynamic MCP redirect targets in the authorization-page form action. Callback-runtime, malicious-302, and CSP regressions pass. The final production version is `e83324b1-277e-4cef-b068-e0f2b7b29525`; CI `29446432189` succeeded. Independent review reported no findings.

## Verification evidence

| Check | Result |
|---|---|
| Root unit / safety | 28/28; safety passed |
| MCP discovery | 62 tools; required read/write/discovery helpers present |
| Release consistency | 30/30 |
| Worker tests | 21/21 |
| Wrangler dry run | Passed |
| Root live integration | 46 passed, 0 failed, 4 skipped; reversible write fixtures cleaned up |
| CI `29446432189` | Node 18/20/22, Worker, dependency/security/secret, release, discovery, dry-run jobs passed |
| Public probes | Landing/discovery/icon 200; unauthenticated `/mcp` 401 with correct challenge |
| Signed-in hosts | ChatGPT, Claude.ai, and Mistral Vibe Work authenticated, invoked the connector, returned budgets, and reported `writes_enabled: true` |

## Open and residual items

1. **Pending brand decision:** the page integration mark has an express terms basis; the App Store-sourced consumer icon does not have equivalent permission recorded in the repo. The directory draft now records that distinction, but broader clearance remains a prerequisite for public listing.
2. **Pending write acceptance:** a hosted write/undo test requires separate approval for an exact reversible financial operation.
3. **Pending YNAB rollout:** [YNAB's OAuth documentation](https://api.ynab.com/#oauth-applications) says a new OAuth application starts in Restricted Mode, may obtain 25 access tokens for users other than the application owner, and requires a review that takes 2 to 4 weeks to remove the limit. No removal request or directory submission was made.
4. **Accepted host caveat:** connector presentation fields and cached historical cards remain host-owned even when MCP metadata is current. Mistral's live connector record now carries the square icon and full description.
5. **Accepted storage caveat:** Durable Objects make transient-state consumption atomic, but KV token/undo updates still lack compare-and-swap and rely on defensive re-read/conditional rollback.
6. **Accepted provenance caveat:** npm/MCP metadata remains 5.1.0 while Worker hardening continued post-tag. Exact final identity is package 5.1.0 + git `2d94a81` for implementation + Worker `e83324b1…`; `9cf65c6` is the final documentation commit.

## Inferences kept separate

- Standards metadata suggests other OAuth/DCR hosts beyond the three accepted clients should interoperate, but only a signed-in flow proves it.
- Some intermediate Worker versions map to adjacent commits by time only; the final deployed version and implementation commit are verified directly.

## Audit disposition

There is no known open critical implementation defect at `2d94a81`; source
review, tests, CI, deployment, public probes, and the three signed-in host
flows are clean. The private connector audit is closed. Write/undo acceptance,
consumer-icon clearance, YNAB Restricted Mode review, and public-listing
decisions remain separate rollout work.
