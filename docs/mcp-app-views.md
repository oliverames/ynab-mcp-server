# MCP App views

Two read-only views render inside hosts that support MCP Apps. Source lives in `lib/app-views.mjs` and `lib/app-views/`.

| Resource | Tool that links it | Data it reads |
| --- | --- | --- |
| `ui://ynab/budget-overview` | `get_month` | `structuredContent.result` of `get_month` (month totals, categories, goals) |
| `ui://ynab/transaction-review` | `review_unapproved` | `structuredContent.result` of `review_unapproved` (full, compact or summary mode) |

Each tool carries `_meta.ui.resourceUri` (plus the legacy `ui/resourceUri` key). Each resource is served as `text/html;profile=mcp-app` and is one document: stylesheet, view script and the `@modelcontextprotocol/ext-apps` client are inlined, so there are no network loads and no `_meta.ui.csp` entries. `_meta.ui.domain` is not set because stdio servers have no URL to derive it from.

## Safety

- No write path. The only tool a view calls itself is `get_month` (month arrows, shown when the host allows `serverTools`).
- Approve and categorize buttons call `app.sendMessage` with a request to *propose* a change and then follow `preview_write_tool`. The message carries transaction ids, dates and amounts only. Payee, memo and import strings are untrusted and stay out of it.
- Data strings reach the DOM through `textContent` and `createElement` only. `test/app-views.test.mjs` fails if a view source uses `innerHTML`, `eval`, remote URLs, `fetch`, or calls any tool other than `get_month`.
- Amounts are dollars (negative is outflow) formatted with the host locale and tabular numerals. Goal progress is approximate: it uses `balance / goal_target` for target-balance goals and `budgeted / (budgeted + goal_under_funded)` otherwise.

## Look and feel

The styling follows YNAB's visual language: YNAB's published brand colors (midnight, buttermilk, firefly green, blurple, dandelion, sunset), a midnight title bar, lime Ready to Assign banner, rounded green/yellow/red/grey pills with right-aligned tabular amounts, and a Figtree-first font stack that falls back to the host font and then the system sans. There is no logo and no copied artwork: the icons are original inline SVG paths in `shared.js`, and no font or image is embedded. Structural colors and fonts come from the host's `--color-*` and `--font-*` variables when present (Claude supplies them); the palette in `shared.css` is the fallback. There is a single build.

## Previewing

Write the output of `buildViewHtml()` to a file, serve it from any static server and drive it with a small host that answers `ui/initialize` and posts `ui/notifications/tool-result` with a captured `structuredContent`. Check light, dark and a 375px-wide viewport. The host in Claude supplies `--color-*` and `--font-*` variables; without them the views fall back to the palette in `shared.css`.
