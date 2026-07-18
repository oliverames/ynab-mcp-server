# Root Cause: ChatGPT reads YNAB but cannot write

**Date:** 2026-07-18
**Author:** Oliver Ames
**Verdict:** No server defect. The symptom is a **read-only OAuth grant** on the
ChatGPT connection (and, secondarily, a client-side enablement gate — developer
mode, workspace plan/admin approval, or similar). Both are on the client/consent
side, not in this codebase.

The most likely trigger is a read-only *consent choice*, which the user fixes by
reconnecting with the write box checked. The server-side write path is proven
working (see Evidence). ChatGPT's entitlement rules for custom-MCP write actions
are in active rollout and OpenAI's help articles are not fully consistent with
each other; treat OpenAI's live documentation and the user's own workspace as
authoritative rather than any static claim here. The discriminating test is
whether the server writes through the MCP Inspector (it does), which isolates any
remaining block to the client.

## Root cause

Write tools are gated **per session, at OAuth-consent time**, not by a static
server flag:

1. The hosted consent screen shows an **unchecked-by-default** "Allow write
   access" checkbox (`worker/src/pages.js:73`, "Leave unchecked for read-only").
2. If unchecked, the consent POST sets `readOnly: true`
   (`worker/src/ynab-handler.js:274`), which makes **YNAB itself issue a
   read-only token** (`:313`) and stores grant scope `["read"]` with
   `writesEnabled: false` (`:465`, `:469`).
3. That `writesEnabled` prop flows into the per-user Durable Object
   (`worker/src/ynab-mcp.js:19`) → `createYnabServer({ writesEnabled: false })`.
4. In the shared factory, the overridden `server.registerTool` **returns
   `undefined` for every write tool when writes are off** (`index.js:1234-1236`),
   so the write tools are never registered and cannot appear in `tools/list`.

A correct MCP client (ChatGPT, Claude.ai) therefore lists only read tools. The
server is behaving as designed.

## Evidence

| Check | Result | Source |
| --- | --- | --- |
| Write tools implemented + annotated | `update_transaction` etc. exist; `readOnlyHint:false`, `idempotentHint:true`, delete `destructiveHint:true` | `index.js:1134-1159`, `:1218-1254` |
| Registration gate | write tools return `undefined` when `writesEnabled()` is false | `index.js:1234` |
| Contract regression | PASS — writes hidden without flag, present with it, hints correct | `npm run test:safety` → "Safety model checks passed" |
| Unit suite | PASS — 28/28 | `npm run test:unit` |
| Live hosted endpoint | up; `/mcp` → `401` Bearer challenge; metadata advertises `scopes_supported:["read","write"]` | `curl https://ynab.amesvt.com/...` |
| Live write, end-to-end (Test budget only) | memo write → independent read-back match → idempotent double-set (no duplication) → cleared → verified | MCP tool calls, 2026-07-18 |
| Prior acceptance | ChatGPT reported `writes_enabled: true` for a write-authorized grant on 2026-07-15 | `worker/README.md` |

The 2026-07-15 acceptance record shows the hosted connector has surfaced a
write-authorized grant in ChatGPT before. That makes "the current connection was
authorized read-only" the leading explanation over a hard plan-tier wall.

## Ruled out

A (never implemented), B (absent from build), C (false feature flag), E (invalid
schema), F (wrong `readOnlyHint`), K (wrong endpoint/replica), L (proxy strips
PUT/PATCH), M (bad token), N (wrong route/body), O (bad MCP response shape) — all
disproven by the evidence above. The "YNAB namespace vanished mid-conversation"
report is a transient client/session or OAuth-refresh event, distinct from write
permission.

## Fix / follow-up

No code change was required to *restore* writes. The change made was a
**diagnostic improvement** so this state cannot silently mislead again:

- `ynab_auth_status` now returns a host-aware `write_enablement` hint and a
  message that names the READ-ONLY state (`index.js`, `writeEnableGuidance()`).
- The write-disabled error is now host-aware: hosted OAuth users are told to
  reconnect and check "Allow write access" instead of the impossible
  "restart with YNAB_ALLOW_WRITES=1."
- Troubleshooting guidance added to `worker/README.md` and
  `docs/hosted-oauth-connector.md`.

## What the user must do (client side)

1. In the ChatGPT chat with the YNAB app selected, call **`ynab_auth_status`**.
   - `writes_enabled: false` → reconnect the connector and **check "Allow write
     access"** on the YNAB consent screen (new grants default to read-only).
2. If, after a confirmed write grant (`writes_enabled: true`), ChatGPT still will
   not invoke a write tool, the block is **client-side enablement** — developer
   mode, workspace plan, or admin approval — not a connector defect. The server
   side is proven above. Check ChatGPT's current developer-mode / MCP
   documentation and your workspace settings; the exact plan requirements are in
   active rollout, so rely on the live docs rather than a fixed claim.
