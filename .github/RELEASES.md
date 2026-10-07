# Linear release reporting

Linear tracks delivered changes for `ynab-mcp-server` in Ames Consulting's AME team. Keep work in this repository's owning Linear project and reuse an existing GitHub-synced issue before creating another record.

The existing [Release](workflows/release.yml) workflow runs for `v*` tag pushes or authorized manual runs and calls the reporter after publishing a GitHub release and its MCPB bundle. The reporter verifies the published release, the `v<package.json version>` tag's exact commit, and a nonempty uploaded MCPB asset. It then syncs and completes that explicit version in the scheduled Linear pipeline. This record covers GitHub/MCPB distribution. It doesn't verify npm publication or deployment of the [hosted OAuth Worker](../worker/README.md). Those channels need their own receiving checks.

When a change has an AME issue, include its real key in the commit subject, using a form such as `[AME-123] Describe the change`, and preserve it when squashing a PR. The reporter scans delivered Git history with branch-ref detection disabled, so a local branch name alone isn't enough to associate an issue. [Linear's CLI documentation](https://github.com/linear/linear-release/blob/v0.18.0/README.md) describes commit-reference detection.

GitHub secret `LINEAR_ACCESS_KEY` contains this pipeline's scoped key. Its canonical copy is `op://Development/Linear Release - ynab-mcp-server/credential`; resolve it at runtime and keep its value out of files and logs. The reporter doesn't generate AI release notes or change issue statuses. It reuses the existing GitHub release notes.

If delivery succeeds but reporting fails, retry only [Report verified release to Linear](workflows/linear-release.yml). Run it from `main`, supply the full 40-character SHA already delivered, and leave `dry_run` enabled to preview. Disable `dry_run` to record that verified delivery. This workflow doesn't deploy, publish packages or create tags. A completed matching version stays unchanged; a conflicting revision or failed receiving check stops reporting.

The workflow preserves trusted reporting tools separately from the delivered checkout, so it can verify older deliveries that predate the reporter. Source must be clean and belong to this repository. Only an empty pipeline can establish a first baseline. For a newly recorded or matching completed release, the final job reads back its exact version and commit as completed in Linear.

When changing the reporter, run `python3 -m unittest discover -s .github/scripts -p 'test_*.py'` from the repository root. The workflow pins the [official action](https://github.com/linear/linear-release-action) and CLI `v0.18.0`. [Linear Releases](https://linear.app/docs/releases) explains pipeline behavior.
