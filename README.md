<p align="center">
  <img src="assets/icon.png" width="80" height="80" alt="YNAB">
</p>

<h1 align="center">MCP Server for YNAB</h1>

<p align="center">
  <strong>Turn natural-language budget questions into safe, local YNAB API workflows</strong><br>
  <em>Give your AI assistant read-only budget access by default, with explicit write opt-in</em>
</p>

<p align="center">
  <code>58 tools with writes enabled</code> &bull;
  <code>6 guided prompts</code> &bull;
  <code>undo journal</code> &bull;
  <code>YNAB API v1.85</code> &bull;
  <code>read-only by default</code>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@oliverames/mcp-server-for-ynab"><img src="https://img.shields.io/npm/v/%40oliverames%2Fmcp-server-for-ynab?style=flat-square&color=f5a542" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f5a542?style=flat-square" alt="License"></a>
  <a href="https://www.buymeacoffee.com/oliverames"><img src="https://img.shields.io/badge/Buy_Me_a_Coffee-support-f5a542?style=flat-square&logo=buy-me-a-coffee&logoColor=white" alt="Buy Me a Coffee"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &bull;
  <a href="#install-as-a-plugin">Plugin</a> &bull;
  <a href="#install-in-claude-code">Claude Code</a> &bull;
  <a href="#install-in-codex">Codex</a> &bull;
  <a href="#other-plugin-hosts">Other Hosts</a> &bull;
  <a href="#what-you-can-do">What You Can Do</a> &bull;
  <a href="#tools-reference">Tools Reference</a> &bull;
  <a href="#environment-variables">Configuration</a>
</p>

---

Run YNAB through Claude Code, Codex, Hermes, Antigravity, or any stdio MCP host. For clients that need a remote URL, the hosted connector at [`https://ynab.amesvt.com/mcp`](https://ynab.amesvt.com) signs each user in through YNAB OAuth, with no personal access token to copy into another service. Both paths use the same rate-aware tool layer, speak in dollars instead of milliunits, start read-only, and journal writes so they can be undone.

## Why This Exists

YNAB's budgeting philosophy works best when you interact with your budget frequently, but the app interface is not designed for quick questions or careful bulk cleanup. "How much did I spend on groceries this month?" should not require navigating three screens. "Categorize all my Amazon orders from this week" should not become a manual, one-by-one review.

This server gives your AI assistant a safe local interface to YNAB's API, turning natural language into structured budget review and, when explicitly enabled, budget operations. It is designed for real budgeting work: finding overspending, reviewing unapproved transactions, checking category drift, investigating recurring payments, and making verified batch updates without giving the assistant broader access than it needs.

All monetary values are automatically converted between dollars and YNAB's internal milliunits format so the AI never has to think about it. The server uses the [official YNAB JavaScript SDK](https://github.com/ynab/ynab-sdk-js) where it fits, plus direct API calls for newer endpoints and query parameters that the SDK has not caught up with yet.

---

## Quick Start

This package stands on its own as a stdio MCP server. You can install it from this repo as a standalone Claude Code, Codex, Hermes, or Antigravity plugin, or register the npm package directly and let your MCP client launch it on demand. You do not need the older `ames-connectors` marketplace for YNAB.

The npm package is the local, owner-run option. It uses a personal access token because the account owner runs the process. The same repository also powers a hosted OAuth connector for clients that accept remote MCP URLs.

### Connect to the hosted remote server

Add this Streamable HTTP URL to Claude.ai, ChatGPT, Mistral Vibe Work, or another remote MCP client:

```text
https://ynab.amesvt.com/mcp
```

The client opens this connector's consent page and then sends you to YNAB to sign in. Leave the write-access box unchecked for a read-only connection, or enable it when you need the write tools. The connector stores OAuth tokens and undo data with application-layer encryption in Cloudflare KV; the AI client receives only the connector's own scoped token. See the live [privacy policy](https://ynab.amesvt.com/privacy), [data-deletion flow](https://ynab.amesvt.com/delete), and [deployment documentation](worker/README.md).

Signed-in acceptance passed on July 15, 2026, in **ChatGPT**, **Claude.ai**,
and **Mistral Vibe Work**. Each host completed OAuth, invoked the connector,
returned the live budget list, and reported `writes_enabled: true` for the
explicitly write-authorized grant. New grants still default to read-only, and
high-impact tools retain their own `confirmed: true` gate even when write tools
are visible.

Connector cards use the square PNG at
`https://ynab.amesvt.com/assets/icon.png`, generated from the exact same
`codex/assets/icon.png` artwork used by the Codex plugin. The hosted consent,
callback, privacy, and deletion pages retain the permitted “Works with YNAB”
integration mark. The landing page also exposes conventional ICO, 16px, 32px,
and Apple touch icons for host favicon discovery. Host UIs can still cache an
older card image, so those presentation fields may need to be refreshed or
reindexed after the MCP metadata changes.

### Install as a Plugin

Install the standalone marketplace from this repository:

```bash
/plugin marketplace add oliverames/ynab-mcp-server
/plugin install ynab-mcp-server@ynab-mcp-server
```

Install the same marketplace in Codex:

```bash
codex plugin marketplace add oliverames/ynab-mcp-server
codex plugin add ynab-mcp-server@ynab-mcp-server
```

The plugin starts `@oliverames/mcp-server-for-ynab@latest` and preserves the prior `ames-ynab` connector behavior by setting `YNAB_ALLOW_WRITES=1`. Direct MCP registration remains read-only unless you explicitly enable writes.

### Other Plugin Hosts

The repository also carries host-specific marketplace and plugin manifests for Hermes and Antigravity:

| Host | Marketplace | Plugin manifest | MCP config |
|---|---|---|---|
| Claude Code | `.claude-plugin/marketplace.json` | `.claude-plugin/plugin.json` | `.mcp.json` |
| Codex | `.agents/plugins/marketplace.json` | `codex/.codex-plugin/plugin.json` | `codex/.codex-plugin/mcp.json` |
| Hermes | `.hermes-plugin/marketplace.json` | `.hermes-plugin/plugin.json` | `.hermes-plugin/mcp.json` |
| Antigravity | `.antigravity-plugin/marketplace.json` | `.antigravity-plugin/plugin.json` | `.antigravity-plugin/mcp_config.json` |

### 1. Get a YNAB Personal Access Token

Go to [YNAB Developer Settings](https://app.ynab.com/settings/developer) and create a new personal access token.

Do not ask another YNAB user for a personal access token. If you are building a public connector for accounts you do not own, use YNAB OAuth instead.

Credential lookup order:

1. Values passed directly to the MCP process, such as `YNAB_API_TOKEN`.
2. The detected host's plaintext settings: Codex reads `~/.codex/config.toml`, first `[shell_environment_policy.set]`, then `[mcp_servers.ynab.env]`; Claude Code reads `~/.claude/settings.json` under top-level `env`.
3. The other supported agent config as a fallback, useful when a token is already stored locally but the launcher did not inject it.
4. `YNAB_API_TOKEN_FILE`, if configured in any of the sources above.
5. `YNAB_OP_PATH`, if configured in any of the sources above and the `op` CLI is available.

If no token is found, `ynab_auth_status` returns a structured setup guide. Agents should first ask whether the user already has the YNAB token in a password manager such as 1Password. If yes, ask permission before configuring `YNAB_OP_PATH`; otherwise ask the user to add `YNAB_API_TOKEN` to the correct Codex or Claude config file and restart the MCP server.

### 2. Install in Claude Code

Use user scope if you want the server available in all Claude Code projects:

```bash
claude mcp add ynab --scope user \
  -e YNAB_API_TOKEN=your-token-here \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

Add a default budget ID if you do not want tools to use YNAB's `last-used` budget:

```bash
claude mcp add ynab --scope user \
  -e YNAB_API_TOKEN=your-token-here \
  -e YNAB_BUDGET_ID=optional-default-budget-id \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

Use `--scope project` instead of `--scope user` if you want Claude Code to write a project-local `.mcp.json`.

If `~/.claude/settings.json` already contains `env.YNAB_API_TOKEN`, you may omit `-e YNAB_API_TOKEN=...`; the server will read the Claude setting as a fallback if the launcher does not inject it.

Verify Claude Code can see the server:

```bash
claude mcp get ynab
```

If Claude Code reports that `ynab` already exists, remove the old entry and run the add command again:

```bash
claude mcp remove ynab
```

### 3. Install in Codex

Register the same npm package directly with Codex:

```bash
codex mcp add ynab \
  --env YNAB_API_TOKEN=your-token-here \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

With a default budget ID:

```bash
codex mcp add ynab \
  --env YNAB_API_TOKEN=your-token-here \
  --env YNAB_BUDGET_ID=optional-default-budget-id \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

If `~/.codex/config.toml` already contains `YNAB_API_TOKEN` under `[shell_environment_policy.set]` or `[mcp_servers.ynab.env]`, you may omit `--env YNAB_API_TOKEN=...`; the server will read the Codex setting as a fallback if the launcher does not inject it.

Verify Codex can see the server:

```bash
codex mcp get ynab
```

If Codex reports that `ynab` already exists, remove the old entry and run the add command again:

```bash
codex mcp remove ynab
```

### 4. Enable Write Tools (Optional)

By default, the server registers read-only tools only. To expose tools that create, update, import, or delete YNAB data, add `YNAB_ALLOW_WRITES=1` when you register the server:

```bash
claude mcp add ynab --scope user \
  -e YNAB_API_TOKEN=your-token-here \
  -e YNAB_ALLOW_WRITES=1 \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

```bash
codex mcp add ynab \
  --env YNAB_API_TOKEN=your-token-here \
  --env YNAB_ALLOW_WRITES=1 \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

Destructive direct tools, bulk-filter write tools such as `approve_transactions` and `reassign_payee_transactions`, and the generic `ynab_write_tool_execute` helper also require `confirmed: true` in the tool input after explicit user confirmation. For extra protection, pass `expectedMatchedCount` when using bulk-filter writes.

### Manual JSON Config

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@oliverames/mcp-server-for-ynab"],
      "env": {
        "YNAB_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

**Generic MCP client**:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@oliverames/mcp-server-for-ynab"],
      "env": {
        "YNAB_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

If you prefer a global install, point your MCP client at the package binary directly:

```bash
npm install -g @oliverames/mcp-server-for-ynab
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

### Docker (Optional)

The repository ships a `Dockerfile` (also used by registry-hosted builds such as Glama). The container speaks MCP over stdio:

```bash
docker build -t mcp-server-for-ynab .
docker run -i --rm -e YNAB_API_TOKEN=your-token-here mcp-server-for-ynab
```

Add `-e YNAB_ALLOW_WRITES=1` to enable write tools, and `-e YNAB_BUDGET_ID=...` for a default budget.

### 1Password Token Lookup (Optional)

If your token is stored in 1Password, set `YNAB_OP_PATH` instead of `YNAB_API_TOKEN`. The `op` CLI must be installed and authenticated in the environment that launches the MCP server.

```bash
claude mcp add ynab --scope user \
  -e YNAB_OP_PATH="op://Personal/YNAB API Token/credential" \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

```bash
codex mcp add ynab \
  --env 'YNAB_OP_PATH=op://Personal/YNAB API Token/credential' \
  -- npx -y @oliverames/mcp-server-for-ynab@latest
```

### Local Smoke Test

From this repo, you can verify the published npm package without changing any MCP client config:

```bash
YNAB_API_TOKEN=your-token-here npm run smoke:review-unapproved -- --published
```

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
| "What subscriptions am I actually paying for?" | `detect_recurring_charges` finds payee + amount + cadence patterns with annual cost |
| "How am I doing financially?" | `get_budget_health` scores savings rate, age of money, and overspending green/yellow/red |
| "Are my credit card payments fully funded?" | `audit_credit_card_payments` compares card balances to payment categories |
| "Merge my duplicate coffee categories" | `merge_category` moves transactions and budgets in one confirmed call |
| "Split that Costco charge across three categories" | `prepare_split_for_matching` mirrors the imported transaction for UI matching |
| "Undo that last batch approval" | `list_undo_history` → `undo_operation` restores the journaled before-state |
| "Import my latest bank transactions" | `import_transactions` triggers linked account sync |

---

## Features

**YNAB API v1.85 coverage** with 58 tools when writes are enabled, plus MCP prompts and resources:

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
| **Workflows** | 3 | Category merge/retire, split-via-match for imported transactions |
| **Audits** | 2 | Credit card payment funding, reconciliation diagnosis |
| **Analytics** | 3 | Budget health, income/expense + savings rate, recurring-charge detection |
| **Undo & Export** | 3 | Local undo journal for writes, CSV export |

Beyond tools, the server ships **6 MCP prompts** (guided workflows: monthly review, weekly triage, categorize-and-approve, subscription audit, reconciliation, credit card audit) and **4 MCP resources** (`ynab://guide/*`: YNAB methodology, write-safety rules, audit patterns, review flags reference).

### Design Decisions

- **Read-only by default** - write tools are not registered unless `YNAB_ALLOW_WRITES=1` is set. Read tools are annotated with `readOnlyHint: true`; write tools are annotated with `readOnlyHint: false`, idempotency hints, and destructive hints for delete operations.
- **Structured contracts for app clients** - every tool exposes a human-readable title, an input schema even when it takes no arguments, an output schema, and matching `structuredContent`. Impact hints describe YNAB as a private, bounded system so app clients can distinguish reads, writes, and destructive operations accurately.
- **Explicit destructive confirmation** - delete tools require `confirmed: true` in their input after user confirmation. Bulk-filter writes also require `confirmed: true`, and support `expectedMatchedCount` when the current match count needs to be locked before mutation.
- **Dollar amounts everywhere** - inputs and outputs are in dollars (`-12.34`), never milliunits (`-12340`). Conversion is automatic and transparent.
- **Smart budget resolution** - set `YNAB_BUDGET_ID` for a default, or omit it to auto-resolve to your last-used budget. Every tool accepts an optional `budgetId` override.
- **Pinned YNAB host** - all HTTP requests are restricted to `https://api.ynab.com`, redirects are not followed, and API tokens are redacted from surfaced errors.
- **Agent-aware token fallback** - use direct process env, Codex `~/.codex/config.toml`, Claude `~/.claude/settings.json`, a small token file via `YNAB_API_TOKEN_FILE`, or a 1Password CLI reference via `YNAB_OP_PATH`.
- **Split transactions** - first-class support for subtransactions in create, read, and format operations. Updates can also convert a non-split transaction into a split (the YNAB API does not support editing the subtransactions of an existing split).
- **Current transaction filters** - transaction list tools support `sinceDate`, `untilDate`, type filters, resource filters, and delta requests. YNAB defaults omitted `sinceDate` to one year ago, so pass an explicit older date when you need older history.
- **Bulk operations** - `create_transactions` and `update_transactions` handle arrays in a single API call. Bulk updates can look transactions up by `id` or by `importId`.
- **Verified batch updates** - `update_transactions` refetches the whole batch in a single list request after the bulk API call (instead of one request per transaction, which used to consume the shared rate budget on large batches), retries mismatched fields once through single-transaction updates, and returns a `verification` block so approval counts cannot hide failed category writes.
- **Fetch-then-merge updates** - scheduled transaction updates (which use PUT semantics) automatically fetch the current state and merge your changes, so you only specify what changed.
- **Fuzzy search** - `search_categories` and `search_payees` do case-insensitive partial matching across all entries.
- **Approval workflow with anomaly flags** - `review_unapproved` scans the full transaction history for unapproved entries (YNAB's API defaults to the last year, which would silently hide older stragglers) and groups transactions into "ready to approve" (categorized, split, or transfer) and "needs attention" (uncategorized), and attaches a `flags` array to each transaction surfacing anomalies: `manually_entered` (not bank-imported), `match_broken` (stale match reference), `scheduled_transaction_realized`, `new_payee`, `no_prior_amount_match` (novel amount for this payee), and `category_drift:was_X` (payee categorized differently in the prior 60 days). Group-level flags aggregate the union of all transaction flags. Bulk approval requires `confirmed: true`.
- **Nullable updates** - update tools accept `null` for clearable fields (`memo`, `payeeName`, `categoryId`, `flagColor`) to distinguish "don't change" (omit) from "clear this field" (`null`).
- **Target behavior support** - category create/update tools expose `goalNeedsWholeAmount` for YNAB's "Set aside another" vs. "Refill up to" goal behavior.
- **Delta request support** - high-volume list tools accept `lastKnowledgeOfServer` and return `server_knowledge` when that parameter is provided. `get_budget` supports full delta exports: pass `lastKnowledgeOfServer` to receive every entity changed since that knowledge in one response.
- **Undo journal** - every transaction write is journaled locally with before-state (`~/.ynab-mcp-undo.json`); `list_undo_history` reviews it and `undo_operation` reverses a journaled write. Category/payee/scheduled writes are journaled for audit without automatic undo.
- **Prompts and resources** - guided workflow prompts (monthly review, weekly triage, categorize-and-approve, subscription audit, reconciliation, credit card audit) and a general YNAB-methodology knowledge base as MCP resources, so any host gets the working discipline without a separate skill.
- **Rate-budget surfacing** - responses warn the model when 50 or fewer requests remain in the trailing hour, on top of the client-side limiter that enforces the budget.
- **Debt account support** - loan and debt accounts include `debt_original_balance`, `debt_interest_rates`, `debt_minimum_payments`, and `debt_escrow_amounts` with correct unit conversion (rates stay as percentages, payments convert from milliunits).

---

## Tools Reference

Read tools are available by default. Tools that create, update, import, or delete YNAB data are marked as write tools and are registered only when `YNAB_ALLOW_WRITES=1`.

### User & Budgets

| Tool | Description |
|------|-------------|
| `get_user` | Get the authenticated user |
| `list_budgets` | List all budgets with IDs, names, date ranges, format settings, and default budget. Pass `includeAccounts: true` to include each budget's accounts. |
| `get_budget` | Get budget summary (name, currency, account/category/payee counts). Pass `lastKnowledgeOfServer` for a delta export of every changed entity plus the next `server_knowledge`. |
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
| `update_transaction` | Write tool: partial update - only specified fields change. Can convert a non-split transaction into a split via `subtransactions`. |
| `update_transactions` | Write tool: batch update multiple transactions at once (look up each entry by `id` or `importId`), then verify requested fields persisted using a single batch refetch. Pass `returnSummary: true` for compact counts instead of full objects on large batches (avoids overflowing the tool-result size limit). |
| `approve_transactions` | Write tool: approve unapproved transactions in bulk by filter (`payeeId` / `categoryId` / `accountId`) without hand-listing IDs. Skips uncategorized transactions by default, requires `confirmed: true`, and supports `expectedMatchedCount`. |
| `reassign_payee_transactions` | Write tool: move all transactions from one payee to another, the merge workaround since the YNAB API has no payee delete/merge endpoint. Requires `confirmed: true` and supports `expectedMatchedCount`. |
| `delete_transaction` | Write tool: delete a transaction. Requires `confirmed: true`. |
| `import_transactions` | Write tool: trigger import from linked bank accounts |

### Scheduled Transactions

| Tool | Description |
|------|-------------|
| `list_scheduled_transactions` | List all recurring transactions |
| `get_scheduled_transaction` | Get a specific scheduled transaction |
| `create_scheduled_transaction` | Write tool: create a recurring transaction with frequency |
| `update_scheduled_transaction` | Write tool: update (fetch-then-merge preserves unchanged fields) |
| `delete_scheduled_transaction` | Write tool: delete a scheduled transaction. Requires `confirmed: true`. |

**Supported frequencies:** `never`, `daily`, `weekly`, `everyOtherWeek`, `twiceAMonth`, `every4Weeks`, `monthly`, `everyOtherMonth`, `every3Months`, `every4Months`, `twiceAYear`, `yearly`, `everyOtherYear`

### Convenience

| Tool | Description |
|------|-------------|
| `review_unapproved` | Get unapproved transactions grouped by readiness: "ready to approve" (categorized, split, or transfer) vs. "needs category first" (uncategorized). Each transaction includes a `flags` array highlighting anomalies (manually_entered, match_broken, no_prior_amount_match, category_drift, new_payee, scheduled_transaction_realized) computed against 60 days of payee history. Includes a warning against blind approval. Pass `summary: true` for counts + by-payee aggregates only, or `compact: true` to keep per-transaction rows (with IDs) while dropping bulky fields so the response fits inline. |
| `get_overspent_categories` | Get categories with negative balances for a month, useful for finding prior-month overspending that reduces the current month's Ready to Assign. |

### Workflows (v4.0)

The YNAB API has no category merge/delete endpoint and cannot split an already-imported transaction; these composite tools do everything the API allows and report the remaining manual UI step.

| Tool | Description |
|------|-------------|
| `merge_category` **(write)** | Recategorize every transaction from one category into another and move budgeted amounts (`moveBudgetedMonths: none/current/all`, capped at 24 months). The emptied source category is then hidden/deleted by hand in the YNAB UI. Requires `confirmed: true`. |
| `retire_category` **(write)** | Prepare a category for deletion: move its transaction history to a replacement category and zero its budgets (dollars return to Ready to Assign). Requires `confirmed: true`. |
| `prepare_split_for_matching` **(write)** | Create a mirror unapproved split transaction that YNAB will offer to match with an imported original, the only way to get splits onto a bank-imported transaction. Requires `confirmed: true`. |

### Audits & Analytics (v4.0, read-only)

| Tool | Description |
|------|-------------|
| `audit_credit_card_payments` | Compare each credit card's balance against its Credit Card Payment category and report underfunded cards. |
| `audit_account_reconciliation` | Per-account reconciliation status; with `accountId`, lists the exact uncleared/unapproved items to check against the bank statement. |
| `get_budget_health` | Snapshot with green/yellow/red indicators: savings rate, age of money, Ready to Assign, overspending, credit card debt. |
| `get_income_expense_summary` | Income vs. spending by month with savings rate, transfers excluded. |
| `detect_recurring_charges` | Find subscriptions/recurring charges from history by payee + amount + cadence, with estimated annual cost. |
| `export_transactions` | Export filtered transactions as CSV text. |

### Undo Journal (v4.0)

Every transaction write (create, update, bulk update, approve, reassign, delete, and the category workflows) is journaled to a local file (`~/.ynab-mcp-undo.json`, last 100 entries) with before-state.

| Tool | Description |
|------|-------------|
| `list_undo_history` | List journaled writes, newest first, with undo capability per entry. Reads only the local journal. |
| `undo_operation` **(write)** | Reverse a journaled write: restore updated fields, delete created transactions, or recreate a deleted one (without its original bank-import linkage). One undo per entry. Requires `confirmed: true`. |

---

## Workflow Safety Notes

### Write Tool Opt-In

The server starts in read-only mode. Write tools are not merely discouraged; they are absent from `listTools` unless `YNAB_ALLOW_WRITES=1` is present when the MCP process starts. This mirrors the safer hosted-connector pattern: the default permission set can inspect budgets, transactions, categories, payees, months, and scheduled transactions, but it cannot mutate financial data.

If a client already has the process running, changing the environment is not enough. Restart the MCP server after setting or clearing `YNAB_ALLOW_WRITES`.

High-impact writes require confirmation in the tool input, not only in surrounding chat. This applies to direct delete tools, `approve_transactions`, `reassign_payee_transactions`, and `ynab_write_tool_execute`:

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

`update_transactions` protects this path by refetching the batch after the bulk API call (one list request for the whole batch, not one request per transaction) and comparing the persisted fields with the requested fields. If anything differs, it retries that transaction once through a single-transaction update. The response includes:

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

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `YNAB_API_TOKEN` | Yes* | (none) | [Personal access token](https://app.ynab.com/settings/developer) from YNAB Developer Settings. Read from process env first, then supported Codex and Claude plaintext agent settings. |
| `YNAB_API_TOKEN_FILE` | No | (none) | Path to a file containing only the token. The file must be 4 KB or smaller. Used only when `YNAB_API_TOKEN` is unset, and can be provided through process env or agent settings. |
| `YNAB_BUDGET_ID` | No | `last-used` | Default budget ID. If omitted, tools use YNAB's most recently accessed budget. Run `list_budgets` to find IDs. |
| `YNAB_ALLOW_WRITES` | No | read-only | Set to `1` to register write tools. Any other value keeps the server read-only. |
| `YNAB_OP_PATH` | No | (none) | 1Password secret reference for your API token. Used only if no direct token is configured. Can be provided through process env or agent settings. |
| `YNAB_DISABLE_AGENT_CONFIG_FALLBACK` | No | `0` | Set to `1` to stop the server from reading `~/.codex/config.toml` and `~/.claude/settings.json`. Intended for tests and tightly controlled runtimes. |
| `YNAB_RATE_LIMIT_PER_HOUR` | No | `190` | Client-side rate limiter. Set to `0` to disable for controlled tests. |
| `YNAB_RATE_LIMIT_BURST` | No | `10` | Maximum burst size before rate limiting pauses requests. |
| `YNAB_HTTP_TIMEOUT_MS` | No | `30000` | Per-request timeout in milliseconds. Set to `0` to disable the timeout. |
| `YNAB_HTTP_RETRIES` | No | `2` | Automatic retries for retryable failures. HTTP 429 (rate limited) retries any request because YNAB rejected it before processing; 502/503/504 and network errors retry reads (`GET`/`HEAD`) only. Honors `Retry-After`. Set to `0` to disable. |
| `YNAB_MAX_RESPONSE_BYTES` | No | `8388608` | Maximum direct-fetch response size for newer endpoints. |

*`YNAB_API_TOKEN` is required unless `YNAB_API_TOKEN_FILE` or `YNAB_OP_PATH` is set. These values may come from direct process env, Codex config, or Claude settings.

### 1Password Integration

If you store your YNAB token in [1Password CLI](https://developer.1password.com/docs/cli/), set `YNAB_OP_PATH` to your secret reference and omit `YNAB_API_TOKEN`:

```json
{
  "mcpServers": {
    "ynab": {
      "command": "npx",
      "args": ["-y", "@oliverames/mcp-server-for-ynab"],
      "env": {
        "YNAB_OP_PATH": "op://Personal/YNAB API Token/credential"
      }
    }
  }
}
```

The fallback adds ~1-2s to startup. If `op` is unavailable or the item is not found, `ynab_auth_status` reports the lookup problem and returns setup guidance instead of letting a normal YNAB tool fail with a generic unauthorized error. If no token source is configured, the setup guide tells the calling agent to ask whether you have a token in 1Password or another password manager, request permission before editing agent config, and otherwise ask you to add `YNAB_API_TOKEN` to the appropriate Codex or Claude settings file.

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

The YNAB API allows **200 requests per hour** per access token, enforced on a rolling window. This server applies a client-side limiter at 190 requests per hour with a burst of 10 by default. Each tool call typically uses one API request, except tools that deliberately verify or merge writes (`update_transactions`, `approve_transactions`, `reassign_payee_transactions`, `update_scheduled_transaction`) which perform a small, constant number of additional reads. Batch verification uses one list request for the whole batch regardless of batch size.

If a request still hits YNAB's limit (HTTP 429), the server waits for the `Retry-After` interval and retries automatically (up to `YNAB_HTTP_RETRIES` times). Transient 502/503/504 responses and network failures are retried for read requests only, since a failed write may have partially applied on the server.

Set `YNAB_RATE_LIMIT_PER_HOUR=0` only for controlled local tests or smoke checks where you know you will stay under YNAB's API limit.

When the trailing-hour budget drops to 50 requests or fewer, tool responses append a pacing warning so the calling model can switch to delta requests, summary modes, and batch tools before hitting the wall.

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
- **Auth:** Bearer token via process env, Codex or Claude agent config, `YNAB_API_TOKEN_FILE`, or `YNAB_OP_PATH` for local owner-run use
- **SDK:** Official [`ynab`](https://www.npmjs.com/package/ynab) v4.1+ for core endpoints, direct `fetch` for newer API features and v1.85 transaction filters
- **Safety:** read-only default, explicit write opt-in, confirmation gates for destructive and bulk-filter writes, host-pinned HTTPS requests to `api.ynab.com`, no redirect following, redacted token errors
- **Validation:** All parameters validated with [Zod](https://zod.dev) schemas
- **Error handling:** API errors are caught, formatted, and returned as MCP error responses with detail messages

The hosted OAuth connector runs on Cloudflare Workers at [`ynab.amesvt.com`](https://ynab.amesvt.com). Its implementation notes are in [worker/README.md](worker/README.md) and [docs/hosted-oauth-connector.md](docs/hosted-oauth-connector.md). For data handling details for the local package, see [docs/privacy.md](docs/privacy.md).

The Cloudflare connector is separate from the private Glama deployment below.
YNAB initially places OAuth applications in Restricted Mode: the owner is
exempt, while the app may obtain at most 25 access tokens for other users before
new authorizations are blocked. YNAB says removal review takes 2 to 4 weeks.
No review or public directory submission is part of the current deployment.

### Glama Hosting

The repo is ready for [Glama](https://glama.ai) MCP hosting: the root [`glama.json`](glama.json) claims the registry listing (per [Glama's glama.json spec](https://glama.ai/blog/2025-07-08-what-is-glamajson)), and the [`Dockerfile`](Dockerfile) is what Glama's GitHub integration builds. To deploy: Glama dashboard → MCP Hosting → deploy from GitHub → select this repo, then set environment variables `YNAB_API_TOKEN` (required), `YNAB_BUDGET_ID` (recommended), and `YNAB_DISABLE_AGENT_CONFIG_FALLBACK=1` (no agent config files exist in the container). Leave `YNAB_ALLOW_WRITES` unset until you have verified the deployment read-only, and keep the deployment **private** because its env vars hold your personal token. `YNAB_OP_PATH` is unsupported in hosted containers (no 1Password CLI); the server reports this explicitly and falls back to discovery-only mode rather than crashing. Glama wraps the stdio transport as a Streamable HTTP Gateway endpoint automatically.

### Public Listing Readiness

This repository is production-ready as a local owner-run stdio MCP package.
The hosted OAuth connector is live under the YNAB application's initial
Restricted Mode and has completed private signed-in acceptance in ChatGPT,
Claude.ai, and Mistral Vibe Work. Public review and directory publication remain
separate decisions:

- If YNAB accepts a local owner-run package, submit this package with the published privacy policy, non-affiliation language, read-only default, write opt-in, confirmation gates, and test evidence.
- The hosted connector uses the YNAB authorization-code flow with PKCE, a public privacy policy, and a user-facing deletion flow.
- Keep public display names in the "for YNAB" pattern and avoid names that imply sponsorship or official support.

---

## Testing

### Offline Tests (no YNAB account required)

Unit tests cover the pure helpers (amount conversion, ID normalization, update verification, config parsing, URL safety, executor input validation), and the safety-model tests boot the real server over stdio to verify the read-only default, write-tool gating, annotations, and credential fallback behavior:

```bash
npm run test:unit
npm run test:safety
cd worker && npm test
```

The root suites run in CI (`.github/workflows/ci.yml`) on Node 18, 20, and 22 for every push and pull request, along with `release:check` and a credential-free MCP smoke test. The Worker suite covers consent-page escaping, OAuth state and PKCE, encrypted KV records, token refresh races, and paginated grant deletion.

### Live Integration Tests

The integration test suite runs against a live YNAB budget. Most write tests create temporary transactions and delete or restore them, but category and category group creation is not reversible through the public API and is skipped unless explicitly enabled.

```bash
YNAB_API_TOKEN=your-token YNAB_BUDGET_ID=your-budget-id npm test
```

Use `YNAB_TEST_BUDGET_ID` to target a dedicated test budget without changing your server default. To include category and category group creation coverage, run with `YNAB_RUN_NONREVERSIBLE_TESTS=1`.

Tests cover all tool categories: reads, reversible writes, bulk operations, search, split transactions, scheduled transaction CRUD with fetch-then-merge verification, money movements, and payee locations.

### MCP Smoke Tests

Use the smoke tests when you need to prove the server is reachable over stdio without reconstructing a custom MCP client. These commands use the official MCP SDK client, the same transport shape used by normal MCP hosts. `smoke:list-tools` can run without a live token to verify discovery, but live read and write smokes need a token from process env, supported Codex or Claude settings, `YNAB_API_TOKEN_FILE`, or `YNAB_OP_PATH`.

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

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local checks and pull request guidelines. Report suspected vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

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
npm run sync:plugin
npm run release:check
npm pack --dry-run
```

After publishing, run `npm run release:check:registry` to verify the npm `latest` dist-tag and repo metadata agree on the same version. `npm run build:mcpb` remains available for an explicit local bundle, but the normal install path is direct MCP registration through npm.

Pushing a `v*` tag triggers the release workflow (`.github/workflows/release.yml`), which verifies the tag against `package.json`, re-runs the offline tests and consistency checks, builds the MCPB bundle, and publishes a GitHub release with the bundle attached.

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
