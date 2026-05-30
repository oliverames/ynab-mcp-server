# Codex Session Handoff: YNAB Connector Access Failures

Date: 2026-05-27
Repo: `/Users/oliverames/Library/Mobile Documents/com~apple~CloudDocs/Developer/Projects/ynab-mcp-server`
Requested plugin: `@ames-ynab` from `ames-connectors`

## Executive summary

This session exposed two different problems:

1. Agent behavior failure:
   The agent ignored the user's explicit request to use `@ames-ynab` directly and called unrelated tools first (`Google Workspace`, `Excel`, `Apple Notes`, `Canva`, `Apple Docs`). Those calls were not connector bugs. They were operator error.

2. Real connector delivery and debugging friction:
   The YNAB MCP server itself worked once reached through a proper MCP client, but the normal Codex path did not expose callable YNAB tools in-session. The session had to fall back to a temporary local MCP client to reach the server over stdio.

The important conclusion is that the runtime server appears mostly healthy. The larger problems are release mismatch, discoverability/surfacing, and missing first-class debug ergonomics.

## Scope boundaries

This report intentionally separates issues by owner.

### Not a bug in this repo

- The agent calling unrelated tools before using YNAB
- Codex host behavior that fails to surface a callable YNAB namespace after plugin mention
- Codex CLI lacking a direct `mcp call` or equivalent command

These are real problems, but they are not fixable only inside this repo.

### In scope for this repo

- Release/version drift between repo, npm, and README
- Missing "how to debug this over stdio" documentation
- Missing smoke-test helper for "can I actually call `review_unapproved` right now?"
- Missing release hygiene that would make host/plugin issues easier to diagnose

### Likely in scope for `ames-connectors` or Codex plugin wiring, not this repo

- Plugin mention does not hydrate callable YNAB tools into the active session
- `tool_search` finds YNAB-related results, but the active tool list never exposes a `ynab` namespace
- Installed connector uses `npx -y @oliverames/ynab-mcp-server@latest`, but host behavior still depends on marketplace wrapper metadata and cache refresh

## What happened in this session

### User intent

The user asked:

- "Let's take a look at transactions that need to be reviewed..."
- explicitly via `[@ames-ynab](plugin://ames-ynab@ames-connectors)`
- later clarified: "Just use `@ames-ynab` directly."

### What went wrong first

The agent wandered into unrelated tools:

- Google Workspace account management
- Excel workbook metadata
- Apple Notes account listing
- Canva connector calls with dummy parameters
- Apple Docs update listing

This created noise and hid the real issue: the YNAB connector was installed, but not available as a directly callable tool namespace in the active tool list.

### What was verified live

These commands confirmed the connector existed and had credentials:

```bash
codex mcp list
codex mcp get ynab-mcp-server
```

Observed:

- `ynab-mcp-server` was enabled
- transport was `stdio`
- command was:

```bash
bash -c "cd /tmp && npx -y @oliverames/ynab-mcp-server@latest"
```

- environment included:
  - `YNAB_API_TOKEN`
  - `YNAB_BUDGET_ID`
  - `OP_SERVICE_ACCOUNT_TOKEN`

The shell also confirmed the credentials were present:

```bash
printf "YNAB=%s\nOP=%s\n" "${YNAB_API_TOKEN:+set}" "${OP_SERVICE_ACCOUNT_TOKEN:+set}"
```

## Key findings

## Finding 1: Repo version, npm version, and README version are out of sync

Severity: High
Owner: This repo and release process

### Evidence

Repo source version:

```bash
node -p "require('./package.json').version"
```

Result:

```text
1.8.1
```

Published npm version:

```bash
npm view @oliverames/ynab-mcp-server version
```

Result:

```text
1.7.1
```

README still points to `v1.4.0` release assets:

- `README.md` release badge uses `v1.4.0`
- `README.md` MCPB section links to `ynab-mcp-server-1.4.0.mcpb`

### Why this matters

There are three competing "current versions":

- repo source: `1.8.1`
- npm install target used by `npx @latest`: `1.7.1`
- human-facing README artifact: `1.4.0`

This makes host behavior hard to reason about. A user or another agent can believe they are using "latest" while actually running older code. It also makes debugging any session-level issue ambiguous because the answer to "what code is the connector running?" is not obvious.

### Fix

1. Publish the current runtime code to npm.
2. Update the README release badge and MCPB download links to the actual latest shipped version.
3. Add a release checklist item that rejects publishing when:
   - `package.json` version
   - npm latest version
   - README release links
   - MCPB artifact references
   are inconsistent.

### Suggested implementation

- Prefer shipping `1.8.2` rather than retroactively trying to re-explain `1.8.1`.
- Update `README.md` release URLs and badge to match the new published version.
- Add a script that checks:

```bash
node -p "require('./package.json').version"
npm view @oliverames/ynab-mcp-server version
rg "v1\\.[0-9]+\\.[0-9]+" README.md
```

and fails if the release metadata disagrees.

## Finding 2: The server works, but the normal Codex session did not expose callable YNAB tools

Severity: High
Owner: Likely `ames-connectors` wrapper or Codex host integration, not this repo alone

### Evidence

- The plugin was explicitly mentioned by the user.
- `tool_search` found YNAB-related matches.
- The active tool surface still never exposed a YNAB namespace with callable tools such as:
  - `review_unapproved`
  - `get_transactions`
  - `update_transactions`
  - `search_categories`
  - `search_payees`

Because of that, the session had to bypass the normal agent tool surface and talk to the installed MCP server manually over stdio.

### Why this matters

This is the main functional failure from the user's perspective. The connector existed, credentials were present, but the session could not call it the normal way.

### Fix direction

This probably requires work outside this repo:

1. Inspect the `ames-connectors` marketplace wrapper for `ames-ynab`.
2. Verify that explicit plugin mention hydrates callable tools into the session.
3. Verify that the namespace/tool metadata exposed to Codex matches the actual MCP server tools.
4. Verify installed-cache refresh behavior after version updates.

### What to inspect outside this repo

- Codex plugin manifest for `ames-ynab`
- any `.codex-plugin/mcp.json` wrapper in `ames-connectors`
- marketplace sync/install cache behavior
- whether tool hydration is gated on plugin install state, cache version, or session start timing

## Finding 3: Codex CLI has no obvious direct "call this MCP tool" path

Severity: Medium
Owner: Codex CLI / host tooling

### Evidence

`codex mcp --help` exposed:

- `list`
- `get`
- `add`
- `remove`
- `login`
- `logout`

There was no obvious `call`, `invoke`, `exec`, or `debug` command for installed MCP servers.

### Why this matters

Once the normal tool surface fails, debugging becomes unnecessarily hard. The agent had to build a custom path just to answer a basic question: "can this installed MCP server respond to `review_unapproved`?"

### Fix direction

Not a fix for this repo, but document the gap clearly. Another agent working across repos should consider adding a debug workflow in the host or marketplace tooling.

## Finding 4: This repo lacks a simple, documented MCP smoke-test path

Severity: Medium
Owner: This repo

### Evidence

The repo does have `test.js`, and it already uses the official MCP SDK client with `StdioClientTransport`. That ended up being the correct pattern.

However:

- there is no short, documented "just list tools and call one live tool" debug flow in the README
- there is no dedicated smoke-test script for host/debug situations
- the quickest reliable path had to be reconstructed from `test.js`

### Working path used in this session

A temporary SDK client installed under `/tmp` successfully connected and called live tools:

1. Create a temp client environment
2. install `@modelcontextprotocol/sdk`
3. use `StdioClientTransport`
4. spawn:

```bash
bash -lc 'cd /tmp && npx -y @oliverames/ynab-mcp-server@latest'
```

5. call:
   - `review_unapproved`
   - `search_categories`
   - `search_payees`
   - `get_transactions`

### Why this matters

This is the difference between "the server is broken" and "the host is not surfacing the server." Right now that distinction is too expensive to establish.

### Fix

Add a dedicated smoke-test script and document it.

### Suggested implementation

Add one or both:

- `scripts/smoke-list-tools.mjs`
- `scripts/smoke-review-unapproved.mjs`

Suggested npm scripts:

```json
"smoke:list-tools": "node scripts/smoke-list-tools.mjs",
"smoke:review-unapproved": "node scripts/smoke-review-unapproved.mjs"
```

The smoke scripts should:

1. connect via `StdioClientTransport`
2. default to the local repo entrypoint (`node index.js`)
3. optionally support a flag or env to test the published `npx @latest` path
4. print:
   - successful connection
   - `tools/list` result
   - one sample tool call result

That would have made this session much shorter.

## Finding 5: The first ad hoc MCP client attempts were fragile

Severity: Low
Owner: Mostly tooling ergonomics, partially docs

### Evidence

Two failed approaches occurred before the correct path:

1. A hand-rolled JSON-RPC framing client that spawned the server but did not complete a successful tool call during the session.
2. An inline Node import of `@modelcontextprotocol/sdk` that failed because the workspace did not have the package installed:

```text
ERR_MODULE_NOT_FOUND: Cannot find package '@modelcontextprotocol/sdk'
```

The reliable path was to use a temp directory with the SDK installed, or the repo's own `test.js` pattern.

### Why this matters

This is not a runtime bug in the server, but it is a debugging tax. The repo should steer users away from fragile ad hoc approaches.

### Fix

Document the supported debug path:

- use local repo dependencies when present
- otherwise use a throwaway temp dir
- do not hand-roll the protocol unless debugging transport framing itself

## Finding 6: README is behind the runtime and may mislead debugging

Severity: Medium
Owner: This repo

### Evidence

`README.md` advertises:

- `44 tools`
- `100% API coverage`
- install/download examples tied to `v1.4.0`

while the repo code is `1.8.1` and npm latest is `1.7.1`.

Even if the tool count is still accurate, the release references are stale enough to create confusion about which artifact is real.

### Fix

Update README during the next release cut and treat it as part of the release artifact, not a best-effort docs task.

## What actually worked

The following server behavior worked once reached through a proper MCP client:

- `review_unapproved` with `summary: true`
- `review_unapproved` full detail
- `search_categories`
- `search_payees`
- `get_transactions`

That is strong evidence that the core server runtime is not the primary failure.

## Recommended fix plan

### Phase 1: Fix the repo-side release/documentation drift

Owner: agent working in this repo

1. Cut and publish a new version, preferably `1.8.2`
2. Update README release links and MCPB artifact references
3. Add a release-consistency check
4. Record the release in `WORKLOG.md`

### Phase 2: Add a first-class smoke-test/debug path in this repo

Owner: agent working in this repo

1. Add a small script that:
   - connects via `StdioClientTransport`
   - lists tools
   - optionally calls `review_unapproved` in summary mode
2. Add README docs for:
   - local debug using `node index.js`
   - published debug using `npx -y @oliverames/ynab-mcp-server@latest`
3. Add an npm script entry for the smoke test

### Phase 3: Investigate why Codex did not surface callable YNAB tools

Owner: agent working in `ames-connectors` and possibly Codex host config

1. Inspect the `ames-ynab` marketplace wrapper
2. Verify plugin mention hydrates active tools
3. Verify cache/install refresh behavior after shipping new versions
4. Compare what `tool_search` says exists vs what the active tool surface actually exposes

This is the highest user-facing failure, but it is probably not solvable only in this repo.

## Concrete instructions for another agent

If another Codex agent is picking this up, use this order:

1. In this repo:
   - verify `package.json` version
   - verify `npm view @oliverames/ynab-mcp-server version`
   - update `README.md` release references
   - add a smoke-test script under `scripts/`
   - add npm scripts for the smoke test
   - run the smoke test locally against `node index.js`
   - if release is intended, publish and verify `npm view` updates

2. In `ames-connectors` or the installed marketplace wrapper:
   - inspect the Codex-facing MCP wrapper for `ames-ynab`
   - verify that explicit plugin mention makes the YNAB tools callable
   - refresh caches and verify with a fresh session

3. In validation:
   - start a fresh Codex session
   - mention `[@ames-ynab](plugin://ames-ynab@ames-connectors)`
   - confirm that the agent can directly call:
     - `review_unapproved`
     - `search_categories`
     - `search_payees`
     - `get_transactions`
   - confirm no fallback temp-client hack is required

## Suggested acceptance criteria

The issue is fixed when all of the following are true:

1. Repo, npm, and README versions agree.
2. A documented smoke-test script exists and passes.
3. Another agent can verify the server with one command, not a custom temp client.
4. In a fresh Codex session, mentioning `@ames-ynab` exposes a directly usable YNAB tool surface.
5. A user asking to "use YNAB directly" no longer forces the agent into unrelated tools or custom protocol workarounds.

## Session evidence snapshot

These repo-local facts were verified during the session:

- repo version: `1.8.1`
- npm latest: `1.7.1`
- README release reference: `v1.4.0`
- installed Codex MCP command:

```bash
bash -c "cd /tmp && npx -y @oliverames/ynab-mcp-server@latest"
```

- live server calls succeeded once reached through an SDK client over stdio

## Proposed follow-up tasks

### Task A: Repo hygiene

- Update README release references
- Publish current runtime version
- Add smoke-test scripts

### Task B: Cross-repo integration

- Audit `ames-connectors` YNAB wrapper
- Verify Codex tool hydration after explicit plugin mention

### Task C: Optional improvements

- Consider adding `outputSchema` to high-value tools if it helps host surfacing or structured consumption
- Consider adding a short `docs/codex-debugging.md` if the smoke-test docs would clutter the README

