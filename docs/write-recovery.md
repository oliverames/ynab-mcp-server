# Recoverable multi-step writes

YNAB does not expose an atomic category merge or a transaction spanning category
allocations. A destination allocation can be credited while clearing the source
fails. Reordering those writes changes the failure mode; it does not make the
operation atomic.

The durable operation runner in `lib/write-recovery.mjs` records the approved
exact plan in the existing journal before the first financial mutation. Each
step contains its target identifiers, relevant before values, absolute intended
after values, attempted-write count, outcome and verified after-state. Category
allocation comparisons use `budgeted` milliunits. Integrated transaction
recategorization also binds the transaction snapshot, including category,
amount, memo, splits and import linkage, to reject intervening transaction edits.
Unrelated category activity does not turn an allocation comparison into a
conflict.

Before changing any allocation the runner freshly checks every planned target,
so an already-stale source amount is detected before the destination receives a
credit. It also freshly reads relevant state before each financial call, requires
the recorded before-state and saves intent before sending the call. It never calculates another
increment on recovery. The caller's writer must set the recorded absolute
after-state and must not automatically retry. The runner always reads back after
the call, including when the response throws or times out.

| Fresh observation | Durable outcome | Next action |
| --- | --- | --- |
| Exact intended after-state after an attempted write | Applied, verified | Continue to the next approved step |
| Exact before-state after a write attempt | Partial; before observed | Stop and offer explicit recovery |
| Neither before nor after | Conflict | Stop; inspect current state and approve a new plan if needed |
| Read unavailable after an attempt | Unknown | Stop; recover using the same operation ID |

An unattempted step already matching after-state is a stale plan, not proof that
this operation made the change. Recovery first rechecks every previously verified
applied step against its recorded after-state. If any changed, the runner stops
before applying remaining steps. Even restoring an already applied step to its
original before-state does not cause the runner to silently apply it again; that
requires a new approved plan. Each step must address a distinct target so its
verified after-state remains unambiguous. Reusing a completed operation ID returns its
historical result without writes; reusing it with a different plan is rejected.

New execution requires the same authenticated tenant, session and budget that
own the plan. A reconnected session in the same tenant and budget can inspect
its operation and request recovery. The MCP caller must obtain a new exact,
expiring preview and explicit human confirmation before passing
`allowSessionRebind: true` to resume. The runner records recovery session IDs;
cross-tenant and cross-budget lookup or recovery is rejected. A preview token or
an operation ID never constitutes human consent.

Journal storage is mandatory for these workflows. Missing storage or failure to
save a plan/intent stops before the next financial write. Failure to save after
a write stops immediately and returns an operation ID; the already persisted
intent allows a subsequent fresh read to discover that the step applied. The
journal adapter must distinguish missing storage from corrupt/unreadable storage
and must not silently replace a damaged journal with an empty one. Protect the
journal as sensitive local financial data and preserve unfinished operation
entries when trimming ordinary undo history.

`createSerializedJournal` shares an in-process queue for operation, audit and undo
updates. Use its `mutate` method for read-modify-write journal updates. If the
backing adapter has compare-and-swap mutation, the wrapper uses it and operation
revisions detect competing recovery writers. Financial API calls run outside CAS
callbacks so an optimistic storage retry cannot repeat a financial call. Local
file storage uses atomic replacement, mode `0600`, file/directory flushing and
an exclusive writer lock with abandoned-process detection. The in-process
queue alone does not provide a cross-process filesystem lock.

These checks reduce accidental repeats and make partial outcomes inspectable.
They cannot guarantee atomicity or prevent changes between a fresh read and a
write. A timed-out HTTP request may still be in flight: observing before-state
does not prove that it was cancelled. Explicit recovery freshly reads again,
and exact-value writes avoid adding the allocation a second time, but external
edits or delayed requests can still race. No financial write is blindly retried,
and no automatic rollback is attempted. Inspect YNAB after conflict/unknown
outcomes and approve any revised recovery plan.

Category workflow source retirement remains manual in YNAB. The YNAB API does
not provide category deletion. Split subtransaction rows require their own
supported edit workflow and must be reported, not silently treated as ordinary
transaction rows.

The synthetic helper test command is `node --test test/recovery.test.mjs`. It covers
applied-write timeouts, unapplied/unknown outcomes, restart recovery, conflicts,
operation IDs, session rebinding, isolation, journal failures, CAS retries,
concurrent journal edits and retention. The MCP-to-HTTP/file-journal command is
`node --test test/category-recovery-integration.test.mjs`. It covers actual
loopback HTTP timeouts and unreadable response bodies, reconnect recovery,
stale previews, conflict detection, tenant isolation, full ordinary merge
history, split reporting and retirement. Both suites use synthetic data and
make no external YNAB calls.

## Undo uncertainty

Undo compares a fresh transaction snapshot to the recorded verified after-state,
including flags, payee identity, deletion/import/match linkage and split lines.
Creation undo is available only when fresh readback matches its creation response;
deleted rows require a fresh tombstone or authenticated not-found read. Legacy
unverified entries do not become automatically reversible. Scalar undo can restore
recorded scalar fields, but structural split changes are audit-only.

Every undo atomically claims its journal entry before its financial request.
If a recreation POST applies but its response is lost, or journal completion fails,
`undo_status: submitted` remains. A second preview is blocked even in another
session, preventing duplicate recreation. Inspect fresh YNAB state manually; the
server does not infer nonapplication from the missing original tombstone.
A multi-row deletion undo can still be partial; it is not an atomic operation.
`list_undo_history` reports that uncertainty only to its authenticated tenant.
