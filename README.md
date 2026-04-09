<p align="center">
  <img src="https://api.ynab.com/papi/logo_api_meadow.svg" alt="YNAB API" width="200">
</p>

<h1 align="center">YNAB MCP Server</h1>

<p align="center">
  <strong>The complete Model Context Protocol server for YNAB</strong><br>
  <em>Give your AI assistant full access to your budget</em>
</p>

<p align="center">
  <code>43 tools</code> &bull;
  <code>100% API coverage</code> &bull;
  <code>YNAB API v1.79</code>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@oliverames/ynab-mcp-server"><img src="https://img.shields.io/npm/v/%40oliverames%2Fynab-mcp-server?style=flat-square&color=f5a542" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f5a542?style=flat-square" alt="License"></a>
  <a href="https://www.buymeacoffee.com/oliverames"><img src="https://img.shields.io/badge/Buy_Me_a_Coffee-support-f5a542?style=flat-square&logo=buy-me-a-coffee&logoColor=white" alt="Buy Me a Coffee"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#what-you-can-do">What You Can Do</a> &bull;
  <a href="#tools-reference">All 43 Tools</a> &bull;
  <a href="#environment-variables">Configuration</a>
</p>

---

## Why This Exists

YNAB's budgeting philosophy works best when you interact with your budget frequently — but the app interface isn't designed for quick queries or bulk operations. "How much did I spend on groceries this month?" shouldn't require navigating three screens. "Categorize all my Amazon orders from this week" shouldn't be a manual, one-by-one process.

This server gives your AI assistant full access to YNAB's API, turning natural language into budget operations. All monetary values are automatically converted between dollars and YNAB's internal milliunits format so the AI never has to think about it. Built on the [official YNAB JavaScript SDK](https://github.com/ynab/ynab-sdk-js) with direct API calls for the newest endpoints (category creation, category groups, money movements) that the SDK hasn't caught up with yet.

---

## Quick Start

### 1. Get a YNAB Personal Access Token

Go to [YNAB Developer Settings](https://app.ynab.com/settings/developer) and create a new personal access token.

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
      "command": "ynab-mcp-server",
      "env": {
        "YNAB_API_TOKEN": "your-token-here",
        "YNAB_BUDGET_ID": "optional-default-budget-id"
      }
    }
  }
}
```

That's it. Your AI can now talk to YNAB.

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

**Complete YNAB API v1.79 coverage** with 43 tools:

| Resource | Tools | Capabilities |
|----------|-------|-------------|
| **Budgets** | 4 | List, view details, settings |
| **Accounts** | 3 | List, view, create |
| **Categories** | 9 | Full CRUD, groups, search, goals, monthly budgets |
| **Payees** | 4 | List, view, rename, search |
| **Payee Locations** | 3 | GPS coordinates for mobile transactions |
| **Months** | 2 | Monthly summaries with per-category breakdown |
| **Money Movements** | 4 | Budget re-allocation tracking |
| **Transactions** | 8 | Full CRUD, bulk ops, split transactions, multi-filter |
| **Scheduled Transactions** | 5 | Full CRUD for recurring transactions |
| **Convenience** | 1 | Unapproved transaction review workflow |

### Design Decisions

- **Dollar amounts everywhere** — inputs and outputs are in dollars (`-12.34`), never milliunits (`-12340`). Conversion is automatic and transparent.
- **Smart budget resolution** — set `YNAB_BUDGET_ID` for a default, or omit it to auto-resolve to your last-used budget. Every tool accepts an optional `budgetId` override.
- **Split transactions** — first-class support for subtransactions in create, read, and format operations.
- **Bulk operations** — `create_transactions` and `update_transactions` handle arrays in a single API call.
- **Fetch-then-merge updates** — scheduled transaction updates (which use PUT semantics) automatically fetch the current state and merge your changes, so you only specify what changed.
- **Fuzzy search** — `search_categories` and `search_payees` do case-insensitive partial matching across all entries.
- **Approval workflow** — `review_unapproved` groups transactions into "ready to approve" (categorized, split, or transfer) and "needs attention" (uncategorized), with a built-in warning against approving uncategorized entries.
- **Nullable updates** — update tools accept `null` for clearable fields (`memo`, `payeeName`, `categoryId`, `flagColor`) to distinguish "don't change" (omit) from "clear this field" (`null`).
- **Debt account support** — loan and debt accounts include `debt_original_balance`, `debt_interest_rates`, `debt_minimum_payments`, and `debt_escrow_amounts` with correct unit conversion (rates stay as percentages, payments convert from milliunits).

---

## Tools Reference

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
| `create_account` | Create a new account (checking, savings, creditCard, mortgage, etc.) |

**Supported account types:** `checking`, `savings`, `cash`, `creditCard`, `lineOfCredit`, `otherAsset`, `otherLiability`, `mortgage`, `autoLoan`, `studentLoan`, `personalLoan`, `medicalDebt`, `otherDebt`

### Categories & Category Groups

| Tool | Description |
|------|-------------|
| `list_categories` | List all category groups and their categories with budgeted/activity/balance |
| `get_category` | Get full category details including goal progress and cadence |
| `get_month_category` | Get category budget for a specific month |
| `update_month_category` | Set the budgeted amount for a category in a month |
| `update_category` | Update name, note, goal target, goal target date, or move to a different group |
| `create_category` | Create a new category in an existing group (with optional goal) |
| `create_category_group` | Create a new category group |
| `update_category_group` | Rename a category group |
| `search_categories` | Case-insensitive partial name search (e.g., "groc" finds "Groceries") |

### Payees

| Tool | Description |
|------|-------------|
| `list_payees` | List all payees with transfer account mappings |
| `get_payee` | Get payee details |
| `update_payee` | Rename a payee |
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
| `get_transactions` | Get transactions with filters: by account, category, payee, month, or status (`unapproved`/`uncategorized`) |
| `get_transaction` | Get a single transaction by ID (includes subtransactions) |
| `create_transaction` | Create a transaction with optional split (subtransactions must sum to total) |
| `create_transactions` | Bulk create multiple transactions in a single API call (supports split transactions) |
| `update_transaction` | Partial update — only specified fields change |
| `update_transactions` | Batch update multiple transactions at once |
| `delete_transaction` | Delete a transaction |
| `import_transactions` | Trigger import from linked bank accounts |

### Scheduled Transactions

| Tool | Description |
|------|-------------|
| `list_scheduled_transactions` | List all recurring transactions |
| `get_scheduled_transaction` | Get a specific scheduled transaction |
| `create_scheduled_transaction` | Create a recurring transaction with frequency |
| `update_scheduled_transaction` | Update (fetch-then-merge preserves unchanged fields) |
| `delete_scheduled_transaction` | Delete a scheduled transaction |

**Supported frequencies:** `never`, `daily`, `weekly`, `everyOtherWeek`, `twiceAMonth`, `every4Weeks`, `monthly`, `everyOtherMonth`, `every3Months`, `every4Months`, `twiceAYear`, `yearly`, `everyOtherYear`

### Convenience

| Tool | Description |
|------|-------------|
| `review_unapproved` | Get unapproved transactions grouped by readiness: "ready to approve" (categorized, split, or transfer) vs. "needs category first" (uncategorized). Includes a warning against blind approval. |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `YNAB_API_TOKEN` | Yes* | [Personal access token](https://app.ynab.com/settings/developer) from YNAB Developer Settings |
| `YNAB_BUDGET_ID` | No | Default budget ID. If omitted, uses `"last-used"` (your most recently accessed budget). Run `list_budgets` to find IDs. |
| `YNAB_OP_PATH` | No | 1Password secret reference for your API token (see below). Required only if using the 1Password fallback instead of `YNAB_API_TOKEN`. |

*`YNAB_API_TOKEN` is required unless `YNAB_OP_PATH` is set.

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

The YNAB API allows **200 requests per hour** per access token, enforced on a rolling window. Each tool call typically uses one API request (except `update_scheduled_transaction` which uses two — a GET to fetch current state, then a PUT to merge changes). The server surfaces rate limit errors as standard MCP error responses.

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  AI Assistant       │────▶│  YNAB MCP Server │────▶│  YNAB API    │
│  (Claude, GPT, etc) │◀────│  (this package)  │◀────│  api.ynab.com│
└─────────────────────┘     └──────────────────┘     └──────────────┘
         MCP                    stdio transport           HTTPS/REST
```

- **Transport:** stdio (standard MCP server pattern)
- **Auth:** Bearer token via `YNAB_API_TOKEN` environment variable
- **SDK:** Official [`ynab`](https://www.npmjs.com/package/ynab) v2.5+ for core endpoints, direct `fetch` for newer API features
- **Validation:** All parameters validated with [Zod](https://zod.dev) schemas
- **Error handling:** API errors are caught, formatted, and returned as MCP error responses with detail messages

---

## Testing

The test suite (43 tests) runs against a live YNAB budget. It creates test data and cleans up after itself:

```bash
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id npm test
```

Tests cover all tool categories: reads, writes, bulk operations, search, split transactions, scheduled transaction CRUD with fetch-then-merge verification, category/group creation, money movements, and payee locations.

---

## Development

```bash
git clone https://github.com/oliverames/ynab-mcp-server.git
cd ynab-mcp-server
npm install
YNAB_API_TOKEN=your-token npm start
```

### Dependencies

- [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) — MCP server framework
- [`ynab`](https://www.npmjs.com/package/ynab) — Official YNAB JavaScript client

Zero additional dependencies. No build step. Pure ESM.

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
