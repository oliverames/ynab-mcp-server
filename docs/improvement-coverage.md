# Approved improvement coverage

Baseline: `605cf4fcaac9716e2a6547f81a760d330f92a967` (remote main,
2026-10-09). The original checkout is clean and preserved; no open PRs were
found. No repository AGENTS.md or .agents/skills instructions were present.

- [x] 1. Issue #32: isolate OAuth consent credentials and sessions; scoped
  refresh, rollback, deletion, legacy migration and multi-user/client tests.
- [x] 2. Correct income/refund/split/transfer accounting without relying on
  English transaction category names; test savings and localized categories.
- [x] 3. Expiring single-use exact write previews, session/budget/entity/value
  binding, fresh stale checks, separate explicit user approval, verified
  after-state conflict-aware undo. Document external API race limits.
- [x] 4. Persist multi-step intent before financial writes, read back each
  step, and expose partial/unknown/conflicting outcomes and explicit recovery.
- [x] 5. Stateful synthetic MCP-to-HTTP-to-journal integration tests and agent
  fixtures: timeout after applied write, retries, partial failure, imports,
  splits, stale previews, undo conflict, malicious bank memo instructions.
- [x] 6. Read-only category suggestions: history, recency, schedules,
  confidence/evidence, abstention for uncertainty/splits, proposed edits gated.
- [x] 7. Tenant-isolated merged TTL/delta cache, freshness, complete history,
  invalidation, fresh writes, lean/full projections; test tombstones, resets,
  isolation and historical changes.
- [x] 8. Add category/payee trends, observational anomalies and scheduled
  balance scenarios; distinguish existing recurring/health/reconciliation.

Implementation verification uses synthetic values and fake tokens. Live YNAB
financial writes and new grants remain out of scope. Oliver subsequently approved
the 6.0 release and hosted rollout; see [6.0.0 notes](release-6.0.0.md) and the
[6.0.1 startup correction](release-6.0.1.md).

## Reference and license review

The pinned [calebl license](https://github.com/calebl/ynab-mcp-server/blob/5f9f14097aa968580348e62692c55d8d18882e14/LICENSE),
[Maronato license](https://github.com/Maronato/ynab-mcp/blob/8274c0d38395c16d745dd0979bf93b9bbd613220/LICENSE),
and [mathbeal license](https://github.com/mathbeal/avenir-mcp/blob/f2815df29f268202e9b657ac96bc05d84e1f4b8a/LICENSE)
were reviewed as conceptual references and declare MIT. New modules are independently implemented; no substantial
reference code is transplanted. Existing notices remain intact. The AGPL
pragprogrammer project is used only for its public [issue #26](https://github.com/pragprogrammer/mcp-ynab/issues/26) requirement:
delta updates must include edits to old transactions, and caches must not
mistake a recent-history subset for complete coverage.

## Validation and limitations

Implemented with the following local checks (synthetic data only):

| Check | Result |
| --- | --- |
| `npm run test:unit` | 240 passing, zero skipped/failures; includes real MCP → loopback fake HTTP/file journal, explicit live-script approval adapter and Worker-global bootstrap regressions; bounded to two test files at once |
| `npm run test:eval` | 7 scripted agent fixtures passing, no provider calls |
| `npm run test:safety` | 45 read-only / 71 write-enabled operations; every direct write requires preview and explicit confirmation |
| `npm run release:check` | Versions, manifests, actual modular tool count and documentation consistent |
| `npm run smoke:list-tools` | Real stdio initialize/list; 71 tools and required helpers present |
| `npm test --prefix worker` | 37 passing, including multi-user/client/consent/session isolation and journal rollback |
| `npx wrangler deploy --dry-run` (worker) | Bundle/schema validation passed, new `YNAB_CREDENTIALS` binding; no deployment |
| Production audits (root and worker) | Zero vulnerabilities |
| Local MCPB build + unpacked runtime | Builds; unpacked runtime imports all modules and advertises 71 tools |
| `npm pack --dry-run`, syntax, `git diff --check` | Runtime modules included and checks pass |

All nine CI jobs passed at implementation head `d0ff361` and release source
`268c05b` (6.0.0). The 6.0.1 correction must pass CI before publication. Passing
local tests does not prove production behavior. Receiving artifact and deployment
checks are recorded separately.

Material behavior changes and honest limits:

- Every direct write now requires a newly reviewed exact preview and separate
  human approval. Existing callers must follow that protocol. No preview is
  issued for pending bank import because its affected IDs/values are unavailable
  before import; ordinary `create_transactions` with import IDs remains supported.
- YNAB offers no conditional writes or multi-step atomicity. A delayed HTTP write
  can still race a read. Partial/unknown outcomes require inspection and explicit
  recovery; successful-response mismatches are never automatically replayed.
- Undo cannot automatically reverse existing split structure or unverified legacy
  state. An uncertain recreation/deletion undo is claimed durably and blocked from
  replay; inspect fresh state manually. Deleted rows lose their bank-import link
  when recreated, as the preview describes.
- Income metadata is deliberately conservative: ambiguous native internal
  category/group flags require explicit `incomeCategoryIds`. Uncategorized
  inflows are disclosed separately. Refunds can yield negative spending.
- Scheduled forecasts use only known manual schedules and current ledger balances;
  they exclude unrecorded spending/settlement and disclose ambiguous twice-monthly
  anchors rather than invent dates. Historical anomalies are observations, not
  fraud or causality judgments.
- Large category workflows stop before writing above 1000 exact steps, and `all`
  allocation scanning remains explicitly capped at 24 months. Transaction history
  is not silently capped. Cache baselines request explicit complete history and
  fail visibly if the configured HTTP size limit prevents retrieving it.
- Cache completeness describes its exact reported interval. The default history
  baseline starts at 1970; an explicitly requested earlier date expands the
  baseline, and later deltas and cursor resets retain that broader coverage.
- Existing hosted shared grants become discovery-only and require reconnection
  after a separately approved deployment. New consents never adopt ambiguous old
  credentials/journals. Multi-step recovery across MCP sessions works within the
  same authenticated consent. The subsequently approved release and rollout
  require independent artifact and production readback checks.
