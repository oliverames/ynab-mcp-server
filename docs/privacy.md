# Privacy Policy for MCP Server for YNAB

Last Updated: July 15, 2026

MCP Server for YNAB is a local stdio MCP server that runs on the user's machine or in a user-controlled MCP host. It connects the user's MCP client to the YNAB API.

This policy covers the local owner-run package published as `@oliverames/mcp-server-for-ynab`. The hosted OAuth connector at `https://ynab.amesvt.com/mcp` has its own current policy at `https://ynab.amesvt.com/privacy`; third-party MCP hosts have their own privacy and retention policies.

## Data Access

The server can access YNAB budget data that the configured YNAB access token is allowed to access, including budgets, accounts, categories, payees, transactions, scheduled transactions, months, and related metadata.

Write tools are disabled by default. They are registered only when `YNAB_ALLOW_WRITES=1` is set before the MCP process starts. Destructive delete tools, bulk-filter write tools, and the generic write executor also require `confirmed: true` in the tool input after explicit user confirmation.

## Data Storage

This package does not create a database and does not store YNAB budget data outside the running MCP process. It returns YNAB API responses to the connected MCP client so the client can answer the user's request.

Authentication is configured by the user through one of these local mechanisms:

- `YNAB_API_TOKEN`
- `YNAB_API_TOKEN_FILE`
- `YNAB_OP_PATH`
- Codex local plaintext settings in `~/.codex/config.toml`
- Claude Code local plaintext settings in `~/.claude/settings.json`

The server does not ask for, handle, or store bank credentials or other financial account login credentials.

## Data Sharing

This package sends YNAB API requests only to `https://api.ynab.com`. Outbound API requests are host-pinned to `api.ynab.com`, HTTPS-only, and redirects are not followed.

The package does not sell YNAB user data and does not intentionally share YNAB user data with third parties. The connected MCP host and AI assistant may receive tool results because that is the purpose of the MCP connection; users should review their MCP host's own privacy and retention policies.

## Logs and Diagnostics

The server redacts bearer tokens and authorization headers from surfaced errors. Users should still avoid pasting tokens, budget exports, or sensitive transaction details into public issues or support requests.

## Deleting Data

Because this local package does not persist YNAB budget data, there is no server-side data store to delete. To stop future access:

1. Remove the MCP server from the MCP host configuration.
2. Delete any local token file or environment variable used for `YNAB_API_TOKEN`.
3. Revoke the personal access token in YNAB Developer Settings.

For the hosted OAuth connector, use `https://ynab.amesvt.com/delete` to revoke connector grants and remove its stored token and undo records.

## Support and Data Requests

For package support, security questions, or data-handling questions, open an issue at https://github.com/oliverames/ynab-mcp-server/issues or contact Oliver Ames through https://ames.consulting.

Because this local package does not operate a server-side data store, data deletion requests usually mean helping the user remove local configuration and revoke the YNAB access token. Hosted connector deletion requests are handled through its public deletion flow.

## Children

This package is not directed to children under 13.

## Non-Affiliation

This connector is not affiliated, associated, or in any way officially connected with YNAB or any of its subsidiaries or affiliates. The official YNAB website can be found at https://www.ynab.com/.

The names YNAB and You Need A Budget, as well as related names, trade names, marks, trademarks, emblems, and images are registered trademarks of YNAB.
