# Read caching and field projections

`get_transactions`, `search_transactions`, `list_accounts`, `list_categories`,
`list_payees`, and `list_scheduled_transactions` accept the same read options:

- `projection: "full"` (default) retains detail; `"lean"` keeps identifiers,
  dollar values, essential status, transfer/match links, and split child IDs and
  amounts. Search operates on full rows before projecting its output.
- `freshness: "fresh"` (default) always requests YNAB. `"cached"` explicitly
  opts into an instance-owned cache with a 30-second TTL. Cached requests return
  an envelope with collection rows and freshness metadata.
- `includeFreshness: true` also returns a freshness envelope for fresh reads.
  Existing fresh array/delta/page response shapes remain the default.

Freshness reports `source`, `fetched_at`, `age_ms`, `ttl_ms`, `complete`,
`coverage`, `server_knowledge`, and the refresh reason. Pagination still reports
`total`, `returned`, `has_more`, and `next_offset`; complete cache coverage does
not imply every row fits in one response. A cached result can be up to its TTL
old. If refresh fails, the request returns an error instead of silently serving
expired history.

The first cached transaction read fetches endpoint history from `1970-01-01`
or the requested `sinceDate` if it is earlier. Its exact coverage is reported as
`kind: "history_since"` with that `since_date`; `complete: true` means complete
within this reported interval, not an assertion that no earlier rows exist.
An older requested date forces a full replacement with an expanded baseline,
even during the TTL. Later requests, deltas, tombstones and cursor-reset full
reads retain the expanded boundary. Subsequent date ranges filter that history
locally, so a recent request cannot hide earlier explicitly requested history.
Concurrent narrower reads cannot satisfy a requested earlier boundary. Month
scopes report their exact month coverage.
Budget-wide unfiltered history refreshes through YNAB's delta cursor, merging
changed rows and removing deleted tombstones. If the cursor decreases or is
missing on a delta response, the cache replaces its baseline with a full read.
Caller-provided `lastKnowledgeOfServer` requests always bypass this cache and
never seed or overwrite it. Their metadata says `complete: false` and
`coverage.kind: "caller_delta"`.

Account/category/payee/month/type transaction scopes replace their full scoped
baseline on expiration. A filtered delta may omit a transaction moved out of
that filter; treating it as a complete merge could retain stale membership.
Using the original endpoint also preserves YNAB's split/hybrid transaction and
uncategorized-filter semantics. Account, category, payee and schedule lists use
complete baselines followed by merged deltas; category child tombstones and
category group moves are handled separately.

Each server factory owns its cache. Opaque authenticated tenant, MCP session,
budget, resource and scope identify its entries; there is no global cache
registry. Hosted authentication supplies the tenant and session identifiers.
Local stdio sessions generate a random session ID; the authenticated local tenant identity is a one-way token fingerprint, allowing journal recovery across process restarts with the same credential. Neither the token nor its fingerprint is returned in ordinary cache metadata. A changed access token clears
cached data, and cached reads still require an available credential.
Dynamic `last-used`/`default` budget aliases always bypass retention because
their target can change. Their metadata reports `refresh:
"dynamic_budget_alias"`; pass a stable budget ID to use caching.
Storage is bounded to 32 entries and 16 MiB of serialized entity data per
instance. Oversized baselines are returned without retaining them;
`freshness.cache_stored` reports whether a network refresh was retained. The
existing HTTP response byte limit also applies to baseline and delta reads.

All real write attempts invalidate every read entry before and after HTTP,
including applied-write timeouts. Reads overlapping an invalidation cannot
repopulate the cache, and their metadata reports `invalidated_during_read`.
Preview capture performs no HTTP write and does not invalidate. Write planning,
verification and undo read freshly because they use the default fresh paths.
The cache is not an atomic snapshot or a lock against changes made by YNAB or
another client; the preview/write safety checks state those API race limits.

Offline unit and transport coverage: `node --test test/cache.test.mjs` (22
tests). Real MCP client → synthetic loopback HTTP coverage:
`node --test test/cache-integration.test.mjs` (6 tests). Fixtures contain only
synthetic transactions, merchants, credentials and balances.
