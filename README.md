<p align="center">
  <img src="assets/icon.png" width="80" height="80" alt="YNAB">
</p>

<h1 align="center">MCP Server for YNAB</h1>

<p align="center">
  <strong>A local Model Context Protocol server for YNAB budget operations</strong><br>
  <em>Give your AI assistant read-only budget access by default, with explicit write opt-in</em>
</p>

<p align="center">
  <code>47 tools with writes enabled</code> &bull;
  <code>YNAB API v1.85</code> &bull;
  <code>read-only by default</code>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@oliverames/ynab-mcp-server"><img src="https://img.shields.io/npm/v/%40oliverames%2Fynab-mcp-server?style=flat-square&color=f5a542" alt="npm"></a>
  <a href="https://github.com/oliverames/ynab-mcp-server/releases/tag/v3.0.0"><img src="https://img.shields.io/github/v/release/oliverames/ynab-mcp-server?style=flat-square&color=f5a542&label=MCPB" alt="MCPB release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f5a542?style=flat-square" alt="License"></a>
  <a href="https://www.buymeacoffee.com/oliverames"><img src="https://img.shields.io/badge/Buy_Me_a_Coffee-support-f5a542?style=flat-square&logo=buy-me-a-coffee&logoColor=white" alt="Buy Me a Coffee"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#install-with-mcpb">MCPB Download</a> &bull;
  <a href="#what-you-can-do">What You Can Do</a> &bull;
  <a href="#tools-reference">Tools Reference</a> &bull;
  <a href="#environment-variables">Configuration</a>
</p>

---

## Why This Exists

YNAB's budgeting philosophy works best when you interact with your budget frequently - but the app interface isn't designed for quick queries or bulk operations. "How much did I spend on groceries this month?" shouldn't require navigating three screens. "Categorize all my Amazon orders from this week" shouldn't be a manual, one-by-one process.

This server gives your AI assistant a safe local interface to YNAB's API, turning natural language into budget review and, when explicitly enabled, budget operations. All monetary values are automatically converted between dollars and YNAB's internal milliunits format so the AI never has to think about it. Built on the [official YNAB JavaScript SDK](https://github.com/ynab/ynab-sdk-js) with direct API calls for endpoints and query parameters that the SDK has not caught up with yet.

---

## Quick Start

### Install with MCPB

For Claude Desktop and other MCPB-compatible clients, download the local bundle from the [v3.0.0 release](https://github.com/oliverames/ynab-mcp-server/releases/tag/v3.0.0):

[Download `mcp-server-for-ynab-3.0.0.mcpb`](https://github.com/oliverames/ynab-mcp-server/releases/download/v3.0.0/mcp-server-for-ynab-3.0.0.mcpb)

The bundle includes the YNAB favicon, production runtime dependencies, and setup prompts for your personal access token, optional default budget ID, and optional write-tool opt-in.

### 1. Get a YNAB Personal Access Token

Go to [YNAB Developer Settings](https://app.ynab.com/settings/developer) and create a new personal access token.

This local stdio package is intended for a YNAB account owner running the server for their own account. A public hosted connector for other YNAB users must use YNAB OAuth instead of asking users for personal access tokens; see [docs/hosted-oauth-connector.md](docs/hosted-oauth-connector.md).

### 2. Configure your MCP client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@oliverames/ynab-mcp-server"],
      "env": {
        "YNAB_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

**Claude Code** (`.mcp.json`):

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@oliverames/ynab-mcp-server"],
      "env": {
        "YNAB_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

Or install globally and point to the binary directly:

```bash
npm install -g @oliverames/ynab-mcp-server
```

```json
{
  "mcpServers": {
    "ynab": {
      "command": "mcp-server-for-ynab",
      "env": {
        "YNAB_API_TOKEN": "your-token-here",
        "YNAB_BUDGET_ID": "optional-default-budget-id"
      }
    }
  }
}
```

That's it. Your AI can now talk to YNAB.

By default, the server registers read-only tools only. To expose tools that create, update, import, or delete YNAB data, add `YNAB_ALLOW_WRITES=1` to the MCP server environment:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@oliverames/ynab-mcp-server"],
      "env": {
        "YNAB_API_TOKEN": "your-token-here",
        "YNAB_ALLOW_WRITES": "1"
      }
    }
  }
}
```

Bulk-filter write tools such as `approve_transactions`, `reassign_payee_transactions`, and the generic `ynab_write_tool_execute` helper also require `confirmed: true` in the tool input after explicit user confirmation. For extra protection, pass `expectedMatchedCount` when using bulk-filter writes.

---

## What You Can Do

| Ask your AI... | What happens under the hood |
|---|---|
| "How much did I spend on groceries this month?" | `search_categories` → `get_month_category` |
| "Show me all unapproved transactions" | `review_unapproved` groups by readiness |
| "Log a $50 Costco trip under groceries" | `search_payees` → `search_categories` → `create_transaction` |
| "Set up monthly $1,500 rent on the 1st" | `create_scheduled_transaction` with `monthly` frequency |
| "Move $200 from emergency fund to dining" | `search_categories` → `update_month_category` (x2) |
| "Categorize all my Amazon orders from this week" | `get_transactions` (filtered) → `update_transactions` (batch) |
| "Create a 'Side Projects' spending category" | `search_categories` (find group) → `create_category` |
| "How has my budget been re-allocated this month?" | `get_money_movements_by_month` |
| "What recurring payments do I have?" | `list_scheduled_transactions` |
| "Import my latest bank transactions" | `import_transactions` triggers linked account sync |

---

## Features

**YNAB API v1.85 coverage** with 47 tools when writes are enabled:

| Resource | Tools | Capabilities |
|----------|-------|-------------|
| **Budgets** | 4 | List, view details, settings |
| **Accounts** | 3 | List, view, create |
| **Categories** | 9 | Full CRUD, groups, search, goals, monthly budgets |
| **Payees** | 5 | List, view, create, rename, search |
| **Payee Locations** | 3 | GPS coordinates for mobile transactions |
| **Months** | 2 | Monthly summaries with per-category breakdown |
| **Money Movements** | 4 | Budget re-allocation tracking |
| **Transactions** | 8 | Full CRUD, bulk ops, split transactions, multi-filter |
| **Scheduled Transactions** | 5 | Full CRUD for recurring transactions |
| **Convenience** | 2 | Unapproved transaction review and overspending checks |

### Design Decisions

- **Read-only by default** - write tools are not registered unless `YNAB_ALLOW_WRITES=1` is set. Read tools are annotated with `readOnlyHint: true`; write tools are annotated with `readOnlyHint: false`, idempotency hints, and destructive hints for delete operations.
- **Dollar amounts everywhere** - inputs and outputs are in dollars (`-12.34`), never milliunits (`-12340`). Conversion is automatic and transparent.
- **Smart budget resolution** - set `YNAB_BUDGET_ID` for a default, or omit it to auto-resolve to your last-used budget. Every tool accepts an optional `budgetId` override.
- **Pinned YNAB host** - all HTTP requests are restricted to `https://api.ynab.com`, redirects are not followed, and API tokens are redacted from surfaced errors.
- **Token fallback options** - use `YNAB_API_TOKEN`, a small token file via `YNAB_API_TOKEN_FILE`, or a 1Password CLI reference via `YNAB_OP_PATH`.
- **Split transactions** - first-class support for subtransactions in create, read, and format operations.
- **Current transaction filters** - transaction list tools support `sinceDate`, `untilDate`, type filters, resource filters, and delta requests. YNAB defaults omitted `sinceDate` to one year ago, so pass an explicit older date when you need older history.
- **Bulk operations** - `create_transactions` and `update_transactions` handle arrays in a single API call.
- **Verified batch updates** - `update_transactions` refetches every requested transaction after the bulk API call, retries mismatched fields once through `update_transaction`, and returns a `verification` block so approval counts cannot hide failed category writes.
- **Fetch-then-merge updates** - scheduled transaction updates (which use PUT semantics) automatically fetch the current state and merge your changes, so you only specify what changed.
- **Fuzzy search** - `search_categories` and `search_payees` do case-insensitive partial matching across all entries.
- **Approval workflow with anomaly flags** - `review_unapproved` groups transactions into "ready to approve" (categorized, split, or transfer) and "needs attention" (uncategorized), and attaches a `flags` array to each transaction surfacing anomalies: `manually_entered` (not bank-imported), `match_broken` (stale match reference), `scheduled_transaction_realized`, `new_payee`, `no_prior_amount_match` (novel amount for this payee), and `category_drift:was_X` (payee categorized differently in the prior 60 days). Group-level flags aggregate the union of all transaction flags. Bulk approval requires `confirmed: true`.
- **Nullable updates** - update tools accept `null` for clearable fields (`memo`, `payeeName`, `categoryId`, `flagColor`) to distinguish "don't change" (omit) from "clear this field" (`null`).
- **Target behavior support** - category create/update tools expose `goalNeedsWholeAmount` for YNAB's "Set aside another" vs. "Refill up to" goal behavior.
- **Delta request support** - high-volume list tools accept `lastKnowledgeOfServer` and return `server_knowledge` when that parameter is provided.
- **Debt account support** - loan and debt accounts include `debt_original_balance`, `debt_interest_rates`, `debt_minimum_payments`, and `debt_escrow_amounts` with correct unit conversion (rates stay as percentages, payments convert from milliunits).

---

## Tools Reference

Read tools are available by default. Tools that create, update, import, or delete YNAB data are marked as write tools and are registered only when `YNAB_ALLOW_WRITES=1`.

### User & Budgets

| Tool | Description |
|------|-------------|
| `get_user` | Get the authenticated user |
| `list_budgets` | List all budgets with IDs, names, date ranges, format settings, and default budget |
| `get_budget` | Get budget summary (name, currency, account/category/payee counts) |
| `get_budget_settings` | Get currency and date format settings |

### Accounts

| Tool | Description |
|------|-------------|
| `list_accounts` | List all accounts with balances, debt details, and import status |
| `get_account` | Get full account details including notes and debt fields |
| `create_account` | Write tool: create a new account (checking, savings, creditCard, mortgage, etc.) |

**Supported account types:** `checking`, `savings`, `cash`, `creditCard`, `lineOfCredit`, `otherAsset`, `otherLiability`, `mortgage`, `autoLoan`, `studentLoan`, `personalLoan`, `medicalDebt`, `otherDebt`

### Categories & Category Groups

| Tool | Description |
|------|-------------|
| `list_categories` | List all category groups and their categories with budgeted/activity/balance |
| `get_category` | Get full category details including goal progress and cadence |
| `get_month_category` | Get category budget for a specific month |
| `update_month_category` | Write tool: set the budgeted amount for a category in a month |
| `update_category` | Write tool: update name, note, goal target, goal target date, or move to a different group |
| `create_category` | Write tool: create a new category in an existing group (with optional goal) |
| `create_category_group` | Write tool: create a new category group |
| `update_category_group` | Write tool: rename a category group |
| `search_categories` | Case-insensitive partial name search (e.g., "groc" finds "Groceries") |

### Payees

| Tool | Description |
|------|-------------|
| `list_payees` | List all payees with transfer account mappings |
| `get_payee` | Get payee details |
| `create_payee` | Write tool: create a new payee |
| `update_payee` | Write tool: rename a payee |
| `search_payees` | Case-insensitive partial name search |

### Payee Locations

| Tool | Description |
|------|-------------|
| `list_payee_locations` | List all payee locations (GPS coordinates from mobile app) |
| `get_payee_location` | Get a specific payee location |
| `get_payee_locations_by_payee` | Get all locations for a specific payee |

### Months

| Tool | Description |
|------|-------------|
| `list_months` | List budget months with income, budgeted, activity, to-be-budgeted, age of money, and notes |
| `get_month` | Get month detail with per-category budget/activity/balance/goal breakdown |

### Money Movements

| Tool | Description |
|------|-------------|
| `list_money_movements` | List all money movements (budget re-allocations between categories) |
| `get_money_movements_by_month` | Get money movements for a specific month |
| `list_money_movement_groups` | List all money movement groups (batched re-allocations) |
| `get_money_movement_groups_by_month` | Get money movement groups for a specific month |

### Transactions

| Tool | Description |
|------|-------------|
| `get_transactions` | Get transactions with filters: by account, category, payee, month, status (`unapproved`/`uncategorized`), `sinceDate`, and `untilDate` |
| `get_transaction` | Get a single transaction by ID (includes subtransactions). Auto-handles composite scheduled-transaction IDs like `uuid_YYYY-MM-DD`; if the underlying matched transaction has been deleted, falls back to returning the active scheduled template wrapped as `{ resource_type: "scheduled_transaction", ... }`. |
| `create_transaction` | Write tool: create a transaction with optional split (subtransactions must sum to total) |
| `create_transactions` | Write tool: bulk create multiple transactions in a single API call (supports split transactions) |
| `update_transaction` | Write tool: partial update - only specified fields change |
| `update_transactions` | Write tool: batch update multiple transactions at once, then refetch and verify requested fields persisted. Pass `returnSummary: true` for compact counts instead of full objects on large batches (avoids overflowing the tool-result size limit). |
| `approve_transactions` | Write tool: approve unapproved transactions in bulk by filter (`payeeId` / `categoryId` / `accountId`) without hand-listing IDs. Skips uncategorized transactions by default, requires `confirmed: true`, and supports `expectedMatchedCount`. |
| `reassign_payee_transactions` | Write tool: move all transactions from one payee to another, the merge workaround since the YNAB API has no payee delete/merge endpoint. Requires `confirmed: true` and supports `expectedMatchedCount`. |
| `delete_transaction` | Write tool: delete a transaction |
| `import_transactions` | Write tool: trigger import from linked bank accounts |

### Scheduled Transactions

| Tool | Description |
|------|-------------|
| `list_scheduled_transactions` | List all recurring transactions |
| `get_scheduled_transaction` | Get a specific scheduled transaction |
| `create_scheduled_transaction` | Write tool: create a recurring transaction with frequency |
| `update_scheduled_transaction` | Write tool: update (fetch-then-merge preserves unchanged fields) |
| `delete_scheduled_transaction` | Write tool: delete a scheduled transaction |

**Supported frequencies:** `never`, `daily`, `weekly`, `everyOtherWeek`, `twiceAMonth`, `every4Weeks`, `monthly`, `everyOtherMonth`, `every3Months`, `every4Months`, `twiceAYear`, `yearly`, `everyOtherYear`

### Convenience

| Tool | Description |
|------|-------------|
| `review_unapproved` | Get unapproved transactions grouped by readiness: "ready to approve" (categorized, split, or transfer) vs. "needs category first" (uncategorized). Each transaction includes a `flags` array highlighting anomalies (manually_entered, match_broken, no_prior_amount_match, category_drift, new_payee, scheduled_transaction_realized) computed against 60 days of payee history. Includes a warning against blind approval. Pass `summary: true` for counts + by-payee aggregates only, or `compact: true` to keep per-transaction rows (with IDs) while dropping bulky fields so the response fits inline. |
| `get_overspent_categories` | Get categories with negative balances for a month, useful for finding prior-month overspending that reduces the current month's Ready to Assign. |

---

## Workflow Safety Notes

### Write Tool Opt-In

The server starts in read-only mode. Write tools are not merely discouraged; they are absent from `listTools` unless `YNAB_ALLOW_WRITES=1` is present when the MCP process starts. This mirrors the safer hosted-connector pattern: the default permission set can inspect budgets, transactions, categories, payees, months, and scheduled transactions, but it cannot mutate financial data.

If a client already has the process running, changing the environment is not enough. Restart the MCP server after setting or clearing `YNAB_ALLOW_WRITES`.

Bulk-filter writes require confirmation in the tool input, not only in surrounding chat:

```json
{
  "confirmed": true,
  "expectedMatchedCount": 3,
  "payeeId": "payee-id-to-approve"
}
```

If `expectedMatchedCount` is provided and the current match count differs, the tool returns an error before mutating any transactions.

### Batch Updates

When a batch operation categorizes and approves transactions at the same time, do not use `review_unapproved` counts as the only success check. Approved transactions leave the review queue even if a category write failed, so queue counts can hide approved-but-still-uncategorized transactions.

`update_transactions` now protects this path by refetching every requested transaction after the bulk API call and comparing the persisted fields with the requested fields. If anything differs, it retries that transaction once through `update_transaction`. The response includes:

```json
{
  "verification": {
    "checked": 1,
    "retried": [],
    "failed": []
  }
}
```

Treat any `failed` entry as a real write failure and inspect the named transaction with `get_transaction`.

### Credit Card Payment Transfers

If two unapproved transactions are clearly a credit card payment plus the matching checking-account outflow, convert them into a transfer before approval. Approving both sides as ordinary categorized transactions preserves the wrong structure and creates cleanup work.

Manual YNAB transfer fixes can replace one side of the pair with a new transaction ID. Read-only verification should not assume both original IDs survive. If one old ID returns `resource_not_found`, inspect recent activity in both involved accounts and verify the pair by `transfer_transaction_id` cross-links.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YNAB_API_TOKEN` | Yes* | [Personal access token](https://app.ynab.com/settings/developer) from YNAB Developer Settings. |
| `YNAB_API_TOKEN_FILE` | No | Path to a file containing the token. The file must be 4 KB or smaller. Used only when `YNAB_API_TOKEN` is unset. |
| `YNAB_BUDGET_ID` | No | Default budget ID. If omitted, uses `"last-used"` (your most recently accessed budget). Run `list_budgets` to find IDs. |
| `YNAB_ALLOW_WRITES` | No | Set to `1` to register write tools. Any other value keeps the server read-only. |
| `YNAB_OP_PATH` | No | 1Password secret reference for your API token (see below). Required only if using the 1Password fallback instead of `YNAB_API_TOKEN`. |
| `YNAB_RATE_LIMIT_PER_HOUR` | No | Client-side rate limiter. Defaults to `190`; set to `0` to disable for controlled tests. |
| `YNAB_RATE_LIMIT_BURST` | No | Maximum burst size before rate limiting pauses requests. Defaults to `10`. |
| `YNAB_HTTP_TIMEOUT_MS` | No | Per-request timeout. Defaults to `30000`. |
| `YNAB_MAX_RESPONSE_BYTES` | No | Maximum direct-fetch response size for newer endpoints. Defaults to `8388608`. |

*`YNAB_API_TOKEN` is required unless `YNAB_API_TOKEN_FILE` or `YNAB_OP_PATH` is set.

### 1Password Integration

If you store your YNAB token in [1Password CLI](https://developer.1password.com/docs/cli/), set `YNAB_OP_PATH` to your secret reference and omit `YNAB_API_TOKEN`:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@oliverames/ynab-mcp-server"],
      "env": {
        "YNAB_OP_PATH": "op://Personal/YNAB API Token/credential"
      }
    }
  }
}
```

The fallback adds ~1-2s to startup and is silently skipped if `op` is unavailable or the item is not found.

---

## Amount Handling

All amounts in tool inputs and outputs are in **dollars** (e.g., `-12.34` for a $12.34 outflow). The server converts to/from YNAB's internal milliunits format automatically.

| Direction | Sign | Example |
|-----------|------|---------|
| Outflow (spending) | Negative | `-50.00` |
| Inflow (income) | Positive | `2500.00` |
| Transfer out | Negative | `-1000.00` |
| Transfer in | Positive | `1000.00` |

---

## Rate Limiting

The YNAB API allows **200 requests per hour** per access token, enforced on a rolling window. This server applies a client-side limiter at 190 requests per hour with a burst of 10 by default. Each tool call typically uses one API request, except tools that deliberately verify or merge writes (`update_transactions`, `update_scheduled_transaction`) which perform additional reads.

Set `YNAB_RATE_LIMIT_PER_HOUR=0` only for controlled local tests or smoke checks where you know you will stay under YNAB's API limit.

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  AI Assistant       │────▶│ MCP Server for   │────▶│  YNAB API    │
│                     │     │ YNAB             │     │              │
│  (Claude, GPT, etc) │◀────│ (this package)   │◀────│  api.ynab.com│
└─────────────────────┘     └──────────────────┘     └──────────────┘
         MCP                    stdio transport           HTTPS/REST
```

- **Transport:** stdio (standard MCP server pattern)
- **Auth:** Bearer token via `YNAB_API_TOKEN`, `YNAB_API_TOKEN_FILE`, or `YNAB_OP_PATH` for local owner-run use
- **SDK:** Official [`ynab`](https://www.npmjs.com/package/ynab) v2.5+ for core endpoints, direct `fetch` for newer API features and v1.85 transaction filters
- **Safety:** read-only default, explicit write opt-in, host-pinned HTTPS requests to `api.ynab.com`, no redirect following, redacted token errors
- **Validation:** All parameters validated with [Zod](https://zod.dev) schemas
- **Error handling:** API errors are caught, formatted, and returned as MCP error responses with detail messages

For a hosted OAuth connector design, see [docs/hosted-oauth-connector.md](docs/hosted-oauth-connector.md). For data handling details for this local package, see [docs/privacy.md](docs/privacy.md).

---

## Testing

The integration test suite runs against a live YNAB budget. Most write tests create temporary transactions and delete or restore them, but category and category group creation is not reversible through the public API and is skipped unless explicitly enabled.

```bash
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id npm test
```

Use `YNAB_TEST_BUDGET_ID` to target a dedicated test budget without changing your server default. To include category and category group creation coverage, run with `YNAB_RUN_NONREVERSIBLE_TESTS=1`.

Tests cover all tool categories: reads, reversible writes, bulk operations, search, split transactions, scheduled transaction CRUD with fetch-then-merge verification, money movements, and payee locations.

### MCP Smoke Tests

Use the smoke tests when you need to prove the server is reachable over stdio without reconstructing a custom MCP client. These commands use the official MCP SDK client, the same transport shape used by normal MCP hosts. `smoke:list-tools` can run without a live token to verify discovery, but live read and write smokes require `YNAB_API_TOKEN`, `YNAB_API_TOKEN_FILE`, or `YNAB_OP_PATH`.

```bash
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id npm run smoke:list-tools
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id npm run smoke:review-unapproved
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id YNAB_ALLOW_WRITES=1 npm run smoke:batch-verify
```

To test the package currently published to npm instead of the local checkout:

```bash
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id npm run smoke:list-tools -- --published
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id npm run smoke:review-unapproved -- --published
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id YNAB_ALLOW_WRITES=1 npm run smoke:batch-verify -- --published
```

`smoke:list-tools` verifies that high-value read tools such as `review_unapproved`, `get_transactions`, `search_categories`, and `search_payees` are present. When `YNAB_ALLOW_WRITES=1` is set, it also verifies `update_transactions`. `smoke:review-unapproved` calls `review_unapproved` with `summary: true` and prints only aggregate counts. `smoke:batch-verify` creates a temporary transaction, uses `update_transactions` to categorize and approve it in one call, refetches it through the MCP server, and deletes it afterward.

---

## Development

```bash
git clone https://github.com/oliverames/ynab-mcp-server.git
cd ynab-mcp-server
npm install
YNAB_API_TOKEN=your-token npm start
```

### Dependencies

- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) - MCP server framework
- [`ynab`](https://www.npmjs.com/package/ynab) - Official YNAB JavaScript client

Zero additional dependencies. No build step. Pure ESM.

### Release Checks

Before publishing, run:

```bash
npm run release:check
npm run build:mcpb
npm pack --dry-run
```

After publishing, run `npm run release:check:registry` to verify the npm `latest` dist-tag, repo metadata, README release links, and MCPB artifact references all agree on the same version.

---

## Privacy and Non-Affiliation

See [docs/privacy.md](docs/privacy.md) for this connector's data handling, deletion, and token-use details.

This connector is not affiliated, associated, or in any way officially connected with YNAB or any of its subsidiaries or affiliates. The official YNAB website can be found at [https://www.ynab.com](https://www.ynab.com/).

The names YNAB and You Need A Budget, as well as related names, trade names, marks, trademarks, emblems, and images are registered trademarks of YNAB.

---

## License

MIT

---

<p align="center">
  <a href="https://www.buymeacoffee.com/oliverames">
    <img src="https://img.shields.io/badge/Buy_Me_a_Coffee-support-f5a542?style=for-the-badge&logo=buy-me-a-coffee&logoColor=white" alt="Buy Me a Coffee">
  </a>
</p>

<p align="center">
  <sub>
    Built by <a href="https://ames.consulting">Oliver Ames</a> in Vermont
    &bull; <a href="https://github.com/oliverames">GitHub</a>
    &bull; <a href="https://linkedin.com/in/oliverames">LinkedIn</a>
    &bull; <a href="https://bsky.app/profile/oliverames.bsky.social">Bluesky</a>
  </sub>
</p>
