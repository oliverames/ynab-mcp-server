# 6.0.0 release and hosted rollout

6.0.0 ships the eight areas in the [coverage checklist](improvement-coverage.md):
OAuth credential/session isolation, correct refund and localized income summaries,
exact previews and conflict-aware undo, recoverable category workflows, synthetic
MCP/HTTP/journal tests, explained category suggestions, complete-history isolated
delta caching and projections, and additive trends/anomalies/scheduled forecasts.

## Write clients must change

Every direct write requires a read-only `preview_write_tool` call, review of its
exact proposed values, explicit human approval, and the same input with the
returned `previewToken` plus `confirmed: true`. The token expires after five
minutes, is single-use, and binds the authenticated session, budget, affected IDs
and relevant before/after values. Possession of a token does not establish human
consent. Execution reads fresh state and rejects stale previews.

Pending bank imports cannot provide exact affected IDs/values before import, so
start those imports in YNAB. Ordinary `create_transactions` with import IDs is
supported; this release does not add a transaction-file parser. Category
suggestions remain read-only proposed edits requiring the normal write protocol.

YNAB does not offer conditional writes or atomic multi-step operations. External
races remain possible. Partial/unknown writes require inspection and explicit
recovery; do not blindly retry. Undo compares verified after-state and refuses
conflicts. Uncertain recreation undo requires manual inspection.

## Hosted clients must reconnect

The existing Worker gains migration `v3`, creating the SQLite `OAuthCredentials`
class and `YNAB_CREDENTIALS` binding. It stores encrypted credentials and operation
journals within one authenticated consent. Existing shared grants become
discovery-only and require each client to reconnect. Reconnection creates a new
consent, which cannot adopt an ambiguous unfinished journal from the old consent;
reconcile those operations before replacing the connection. New MCP sessions
within the same consent can recover that consent's operations.

Deployment uses the existing account, Worker, domain, vars and secrets. No secret
rotation or new access grant is needed. Pending class migrations require direct
Wrangler deployment; version upload/gradual rollout cannot apply them. Cloudflare
blocks rollback to a pre-v3 version, so repair forward while retaining the class,
migration and encrypted state. Preserve pre/post deployment metadata for recovery.

## Release verification and remaining acceptance

Publish from a clean, committed 6.0.0 source after offline gates and CI. Verify the
npm version, latest tag, gitHead, integrity and downloaded source; verify GitHub
tag/source, MCPB asset and no-credential runtime discovery. Production readback
must match the full source SHA, v3, one version at 100%, twelve bindings and three
exported classes, with existing namespaces/domain/settings unchanged and previews
disabled. Homepage/branding/OAuth metadata and unauthenticated MCP checks do not
establish authenticated financial-tool acceptance.

The full authenticated live acceptance remains tracked in [#24](https://github.com/oliverames/ynab-mcp-server/issues/24);
no financial operations or new grants are part of this release verification.
[#34](https://github.com/oliverames/ynab-mcp-server/issues/34) records unverified
billing controls. The per-consent journal size limit is not an aggregate spending
cap; no account or pricing changes are part of this rollout.
