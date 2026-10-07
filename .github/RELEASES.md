# Linear release reporting

The existing delivery workflow reports the published GitHub release and uploaded MCPB bundle; Worker deployment remains separate. Reporting verifies the receiving service and exact source commit before writing to this repository's Linear pipeline. Scheduled package releases are then marked completed; continuous publications complete during sync. Existing release notes are reused without generation or issue-status changes.

The dedicated **Report verified release to Linear** workflow is safe to retry independently. Run it from `main`, enter the full 40-character SHA already delivered, and keep `dry_run` enabled to preview. Turn `dry_run` off only to record that verified delivery. This workflow never deploys, publishes packages, or creates GitHub releases. A matching completed version is left unchanged; a conflicting source SHA fails closed.

Reporter code and configuration come from the workflow revision and are retained separately from the delivered checkout, so earlier releases can be recorded even when their commits predate these files. The CLI scans only the delivered checkout. Source must be clean and belong to this repository. Only an empty pipeline can establish a first baseline. Pipelines with path filters skip delivered commits that have no relevant source changes since their previous release. Rollbacks or unrelated Git histories require review.

GitHub secret `LINEAR_ACCESS_KEY` holds this repository's scoped pipeline key, whose canonical copy is in 1Password. Pages verification reuses the existing Cloudflare deployment secrets for read-only production metadata. No new credential scope is required. A reporting failure does not undo or repeat delivery; retry only this reporting workflow.

Run targeted tests with `python3 -m unittest discover -s .github/scripts -p 'test_*.py'`. The official Linear action is pinned to `30f9ae77461ec29f07fffe0c52edd1909bfbb6f5` and CLI to `v0.18.0`.

Sources: [Linear Releases](https://linear.app/docs/releases), [official action](https://github.com/linear/linear-release-action), [official CLI](https://github.com/linear/linear-release).
