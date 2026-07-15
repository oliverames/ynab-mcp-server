# YNAB complete worklog: 2026-07-15

## Scope and evidence rules

This consolidates the prior Claude-session context, original audit baseline,
git and `WORKLOG.md`, current source, tests/CI, Cloudflare and npm history,
production probes, and signed-in host acceptance through **2026-07-15 16:09
EDT (20:09Z)**.

- **Verified** means supported by source, git, test/CI output, provider metadata, a public probe, or direct host observation.
- **Inferred** means supported by verified chronology but not independently recorded at the event.
- **Pending** means not yet demonstrated end to end.

No secret, authorization code, access/refresh token, OAuth state, client credential, or personal budget detail is included. Temporary smoke clients and states were removed.

## Executive outcome

**Verified:** The project moved from a mature local stdio MCP server to a live multi-user connector at `https://ynab.amesvt.com/mcp`. It now supports Streamable HTTP and legacy SSE, OAuth 2.1 discovery, dynamic client registration, one upstream YNAB login, read-only default with write opt-in, encrypted token/undo storage, privacy and deletion, and the shared local tool layer.

**Verified:** Implementation commit `2d94a81c440f9827221e9558ea583515986a65c3`
and documentation commit `9cf65c6e9904e1f4d6a8cfcc7063792dda41994e`
are on `main` and `origin/main`. Cloudflare version
`e83324b1-277e-4cef-b068-e0f2b7b29525` serves 100% of production traffic. CI
run `29446432189` completed successfully.

**Verified:** ChatGPT, Claude.ai, and Mistral Vibe Work each completed OAuth,
invoked the connector, returned the live budget list, and reported
`writes_enabled: true` for the explicitly write-authorized grant. The private
three-host connector objective is complete.

## Prior Claude-session context and original audit baseline

The remote audit initially found only the local, owner-run stdio implementation. That implementation was already substantial, but it lacked the network and account lifecycle needed by a hosted custom connector.

**Verified local baseline:**

- 58 domain tools plus four discovery/executor helpers, yielding 62 tools in write-enabled discovery;
- complete YNAB endpoint coverage and audited parameters for account inclusion, delta exports, split updates, and import-ID batch addressing;
- Zod validation, dollar/milliunit conversion, response caps, batched refetch verification, rate controls, bounded retries, and redacted failures;
- read-only default, explicit local write opt-in, and confirmation gates for destructive, filter-bulk, and generic-executor writes;
- category workflows, split preparation, audits, health/income-expense/recurring analytics, CSV export, transaction anomaly flags, and summary modes;
- undo journal with history/undo tools, six prompts, and four `ynab://guide/*` resources;
- CI, release/safety/smoke checks, Docker/Glama artifacts, and multi-host plugin metadata.

**Verified prior-session gap:** There was no production HTTP MCP transport, OAuth discovery, DCR, hosted YNAB token vault, per-user connector grant, hosted deletion lifecycle, or signed-in host acceptance. The work therefore expanded from audit to implementation: stable HTTPS MCP, MCP-host OAuth, one YNAB login instead of user-supplied PATs, least-privilege grants, encrypted storage, privacy/deletion, branding, and live host acceptance.

## Implemented architecture and user journey

**Verified:** Commit `8bfa9c1` refactored the root server into `createYnabServer(...)`. Local stdio and Worker instantiate the same tools, prompts, resources, schemas, annotations, write gates, rate/response controls, and undo behavior. The Worker injects a per-user OAuth token getter and KV journal instead of a local PAT and filesystem journal.

The Worker exposes `/mcp` (Streamable HTTP), `/sse` (legacy), `/authorize`, `/token`, `/register`, both OAuth discovery documents, `/privacy`, and `/delete`. It uses one stateful MCP Durable Object and a separate transient-state Durable Object.

**Verified authorization journey:**

1. The host discovers the resource/server and dynamically registers when needed.
2. Connector consent identifies the client and defaults to read-only; the user may explicitly opt into writes.
3. The connector creates a fixed-origin callback and PKCE S256 request, then sends the user to YNAB.
4. After YNAB returns, the Worker exchanges the code and reads the YNAB user ID.
5. A final same-origin confirmation appears before token persistence and grant creation.
6. The host receives only a connector-scoped token; YNAB tokens stay server-side.

“One-login” means one upstream YNAB authentication/approval, not one click: pre-YNAB access selection and post-YNAB final confirmation are intentional.

## Security and lifecycle decisions

**Verified:** OAuth is fail-closed and least-privilege by default.

- MCP hosts receive connector-scoped access tokens, never the upstream YNAB access or refresh token.
- The connector requires S256 PKCE, a fixed production callback origin, single-use opaque consent/state/finalization records, a 10-minute TTL, HTML escaping, strict CSP and response headers, and same-origin checks on authorization forms.
- Consent and callback state moved from origin-wide cookies to server-side Durable Object records after live embedded-browser testing showed that Mistral did not reliably return the cookie. The final implementation supports overlapping tabs without weakening replay or CSRF checks.
- YNAB tokens and undo journals are AES-GCM encrypted before KV persistence using a key separate from the OAuth provider's storage controls. Legacy plaintext records migrate on read.
- Refresh failures preserve the prior record and re-read for a concurrent successful token rotation. Failed connector grant creation restores the prior encrypted record without overwriting a concurrent update.
- `/delete` revokes all paginated connector grants and deletes the encrypted YNAB record and undo journal. Privacy and deletion pages disclose the retained data and project independence.
- Read-only is the default. Write discovery and execution require the explicit connector write choice plus the shared tool layer's write/destructive confirmation rules.

**Decision:** Cloudflare KV has no compare-and-swap operation, so the implementation does not claim atomic KV consumption. Security records instead use unguessable 192-bit IDs, keyed verification, deletion-before-validation, short expiry, replay rejection, and state isolation. The production transient records are implemented with a Durable Object where atomic single-use behavior is required.

## Implementation and deployment chronology

| EDT | Commit / deployment | Verified result |
|---|---|---|
| 09:17 | `8bfa9c1` | Shared server factory and initial Cloudflare Worker connector. |
| 09:35 | `c76d17c` | Production OAuth KV namespace wired. |
| 10:21 | `f01f2be` / tag `v5.1.0` | Hosted OAuth release; npm package `5.1.0`. |
| 10:22 | `9fe3fd8` | Release workflow uses the supported Wrangler runtime. |
| 11:11 | `f004238` | Compliant hosted-page branding and “Works with YNAB” mark. |
| 11:38 | `7b2fee1` | Concurrent consent/callback cookies no longer overwrite each other. |
| 11:52 | `abca0e9` | Cookie-free embedded authorization supported. |
| 12:11 | `a37275b` | Cookie-free state hardened against tamper, replay, and cross-consent. |
| 12:54 | `9900ed4` | Valid origin-less embedded-browser form submissions accepted using Fetch Metadata and same-origin referrer checks. |
| 13:21 | `5e2f43d` | Current YNAB iOS App Store icon advertised for connector discovery. |
| 13:45 | `6c0f901` | Cloudflare `fetch` redirect-mode production failure fixed and regression-tested. |
| 13:45 | Worker `5aa3d9f5-982f-4b3e-883a-2ff52bf81e89` | Redirect-fix version activated on `ynab.amesvt.com`. |
| 15:35 | `30bca1c` | Validated dynamic MCP redirect targets admitted to authorization form actions without weakening other form CSP. |
| 15:35 | `2d94a81` | Every tool gained a title, input/output schemas, matching `structuredContent`, and private/bounded impact hints. |
| 15:56 | `9cf65c6` | Connector-card and hosted-consent icon roles reconciled in submission documentation. |
| Final | Worker `e83324b1-277e-4cef-b068-e0f2b7b29525` | Final implementation serves 100% of production traffic. |

**Verified Cloudflare history (UTC):** initial `835aa177…` at 14:19:28; branding `3a00f10f…` at 15:01:27; intermediate `79ff24f4…` at 15:36:10 (source mapping inferred); concurrent-flow `fb1cb3da…` at 15:37:56; cookie-free `c9f13970…` at 15:52:23; deliberate rollback to `fb1cb3da…` at 15:57:28; atomic-state `980d90fe…` at 16:11:18; Origin-less-browser `e90079d9…` at 17:02:41; secret-change version `1907922f…` at 17:16:39 (no value recorded); app-icon `1aac6026…` at 17:22:03; redirect-fix version `5aa3d9f5…` at 17:45:38; later uploads `35a245ae…` at 18:36:48 and `8dfba136…` at 18:43:03; final `e83324b1…` at 18:58:38. The final source, `origin/main`, and deployed Worker were reconciled after every incident.

**Current repository note:** final documentation commit `9cf65c6` does not
change runtime behavior. The final Worker runtime includes implementation
changes through `2d94a81` and is deployed as `e83324b1…`.

## Live incidents and fixes

### Concurrent and cookie-free embedded OAuth

**Verified:** Early Claude/Mistral attempts exposed two host-browser realities: overlapping authorization tabs overwrote origin-wide security cookies, and Mistral's embedded flow did not reliably return even a fresh first-party consent cookie. The connector first namespaced cookies, then moved security bindings into opaque, single-use server-side records. Production probes registered independent clients, submitted consent without a cookie jar, preserved separate states, rejected replay/tamper, and left the other legitimate state usable.

### Origin-less form posts

**Verified:** A later embedded-browser submit omitted `Origin`. Commit `9900ed4` permits only the narrow same-origin navigation case supported by `Sec-Fetch-Site` and `Referer`; cross-site, opaque-site, and forged-origin variants remain rejected. This was not a blanket relaxation of CSRF enforcement.

### YNAB callback redirect-mode failure

**Verified direct host observation:** On 2026-07-15 at about 13:40 EDT, Mistral created the client flow, the user approved YNAB, and the Worker callback returned:

> Could not exchange the YNAB authorization code (Invalid redirect value, must be one of "follow" or "manual" ...).

No authorization code, state, or credential is retained in this artifact.

**Root cause:** both the YNAB token exchange and the immediately following `/v1/user` request used browser-standard `redirect: "error"`. Cloudflare Workers accepts only `follow` or `manual` and threw before either upstream request completed.

**Fix:** commit `6c0f901` uses `redirect: "manual"` for both credential-bearing calls and rejects status 3xx, `Response.redirected`, or `opaqueredirect` before parsing a response. The code never logs or follows `Location`, so the YNAB client secret, authorization code, refresh token, and bearer token remain pinned to their fixed YNAB endpoints. An independent review reproduced the old TypeError under the installed Workers runtime, verified a real manual 302 is caught, and reported no actionable finding.

## Verification evidence

**Offline and live integration gates for the final implementation:**

- Worker tests: **21 passed, 0 failed**.
- Root live integration suite: **46 passed, 0 failed, 4 intentionally skipped**. This exercised reads and reversible write fixtures against the owner's YNAB account; no personal transaction data is copied here.
- Release consistency: all package, plugin, tool-count, and manifest checks passed.
- Wrangler dry run: passed with the expected Durable Object, KV, and environment bindings.
- `git diff --check`: passed for the redirect fix.
- Independent redirect/security review: clean.
- GitHub Actions CI for final documentation commit `9cf65c6`: successful, run `29446432189`.
- `origin/main` and local `HEAD`: `9cf65c6e9904e1f4d6a8cfcc7063792dda41994e` at final verification.

**Production probes at 2026-07-15 17:47Z:**

- `GET /`: HTTP 200 with no-store and strict page security headers.
- Both protected-resource metadata paths: HTTP 200 with canonical resource `https://ynab.amesvt.com/mcp`, authorization server `https://ynab.amesvt.com`, and read/write connector scopes.
- Authorization-server metadata: HTTP 200 with `/authorize`, `/token`, `/register`, authorization-code and refresh-token grants, S256 PKCE, and supported token authentication methods.
- Unauthenticated MCP `initialize`: HTTP 401 with `WWW-Authenticate` pointing to `/.well-known/oauth-protected-resource/mcp`.
- Current connector PNG: HTTP 200, `image/png`, CORS `*`, immutable caching, 1024x1024, SHA-256 `b1b3180d79d59548fea1ddff1b58622ce66c3ffd1951d416ab4f5d9b63324e0a`.
- Current Cloudflare deployment: `e83324b1-277e-4cef-b068-e0f2b7b29525` at 100% traffic.

## Branding and icon evidence

**Verified server behavior:** Hosted pages continue to use the exact permitted “Works with YNAB” integration mark and required non-affiliation/trademark notice. MCP `serverInfo.icons`, the landing-page favicon, and Open Graph metadata advertise the current public 1024px YNAB iOS App Store icon from the same origin. Source listing, artwork URL, MIME type, dimensions, and digest are pinned in source and tests.

**Important distinction:** YNAB's API Terms expressly permit the integration mark and “for YNAB” naming form; they do not expressly license general reuse of consumer app artwork. The app-list icon is documented as a separate user-directed branding choice, not as a Terms-permitted integration mark.

**Host behavior:** Connector presentation fields are partly host-owned. Mistral
required its separate `icon_url` and description fields to be populated; its
live connector detail now renders the square icon and full non-affiliation
description. ChatGPT accepted the uploaded square PNG. Previously generated
host cards may retain cached older artwork even after the live connector record
is corrected.

## Host-by-host acceptance status

| Host | Current evidence | Status |
|---|---|---|
| Mistral / Vibe Work | [Acceptance chat](https://chat.mistral.ai/work/5343e6ca-af1e-4825-a32e-0d7516093d78) invoked the connector, returned current budget names, and reported authenticated with writes enabled. The live connector details show the square icon and description. | **Verified/complete.** |
| Claude.ai | [Acceptance chat](https://claude.ai/chat/c5132430-bbfc-4905-bb7b-23df6b92298d) invoked the connector, returned current budget names, and reported authenticated with writes enabled. | **Verified/complete.** |
| ChatGPT | [Acceptance chat](https://chatgpt.com/c/6a57daaf-89c8-83ea-b232-5e58401c629a) invoked the connector, returned current budget names, and reported authenticated with writes enabled. | **Verified/complete.** |

All three persistent connector grants were created with explicit user
authorization. Acceptance used read calls only; `writes_enabled: true` proves
the write tool surface is available, not that a financial mutation occurred.

## Remaining constraints and non-goals

- YNAB Restricted Mode currently permits the app owner and at most 25 access tokens for other users. Review to remove that cap is a separate rollout decision; no review form or public directory submission was made.
- Public Claude/Mistral directory publication and Glama hosting are separate from this private custom-connector deployment.
- A live write/undo acceptance remains deliberately excluded until the user explicitly approves an exact financial operation. Offline and root-suite write safety remain verified.
- Custom-host icon behavior is not controlled solely by server metadata and must be observed per host.

## Completion gate

The Cloudflare connector implementation, security remediation, repository
source, CI, deployment, and private three-host acceptance are verified. The
overall user objective is **complete**:

1. connector creation succeeds;
2. OAuth returns successfully through the Worker and YNAB;
3. the connector appears in the host;
4. a fresh sample chat explicitly invokes a connector read tool and returns current YNAB data; and
5. the host's actual listing/composer icon behavior is recorded where the host exposes it.

The remaining write/undo exercise, Restricted Mode review, public directory
publication, and broader trademark review are separate rollout decisions, not
unfinished implementation work.
