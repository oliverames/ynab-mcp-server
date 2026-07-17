# Claude Connectors Directory submission draft

This file prepares the listing fields for a future Directory submission. It
does not authorize publication. Anthropic requires the submission to come from
a Team or Enterprise organization with Directory management access, and the
user must confirm before anyone submits it.

## Listing

- Server name: `YNAB`
- Tagline: `Explore and manage your YNAB budget through Claude`
- Suggested category: Finance
- Server URL: `https://ynab.amesvt.com/mcp`
- Documentation: `https://github.com/oliverames/ynab-mcp-server#readme`
- Privacy policy: `https://ynab.amesvt.com/privacy`
- Support: `https://github.com/oliverames/ynab-mcp-server/issues`
- Company name: `Oliver Ames`
- Company website: `https://ynab.amesvt.com`
- Icon: `https://ynab.amesvt.com/assets/icon.png`

### Description

YNAB connects Claude to a user's own YNAB budget through YNAB's
OAuth flow. It starts with read-only access, so Claude can answer questions
about plans, accounts, categories, payees, months, scheduled transactions, and
spending. A user can opt into write access during sign-in when they want Claude
to create or update budget records.

Write tools keep confirmation checks for destructive actions and record enough
information to undo supported changes. The connector stores encrypted YNAB
OAuth tokens, the YNAB user ID, the user's read or write choice, and an
encrypted undo journal. Users can delete this data and revoke connector grants
at `https://ynab.amesvt.com/delete`.

This is an independent open-source project by Oliver Ames. It is not affiliated
with, sponsored by, or endorsed by YNAB.

## Use cases

- Check balances, spending, and category availability without opening the YNAB app.
- Review uncategorized or unapproved transactions and decide what needs attention.
- Compare spending by category, payee, account, or month.
- Create or update budget records after the user explicitly enables write access.

Users need an active YNAB account with at least one plan. They do not need to
copy a personal access token into Claude. The connector signs them in through
YNAB OAuth and requests read-only access unless they choose write access.

The connector reads and edits records in YNAB's budgeting system. It cannot
transfer money, initiate a bank payment, trade an asset, or access bank login
credentials.

## Data handling answers

- Underlying API: YNAB's third-party API, used under its published API Terms.
- Authentication: OAuth 2.0 with dynamic client registration for the MCP host,
  followed by YNAB's authorization-code flow with PKCE S256.
- Stored data: encrypted OAuth access and refresh tokens, YNAB user ID, read or
  write choice, and encrypted undo entries for connector writes.
- Conversation data: not collected or stored by this connector.
- Health data: none.
- Sponsored content: none.
- Data deletion: `https://ynab.amesvt.com/delete`.
- Privacy policy: `https://ynab.amesvt.com/privacy`.

## Icon roles and trademark basis

Use the square 1024x1024 connector-hosted PNG URL above in Anthropic's icon
field. It is generated from the exact `codex/assets/icon.png` artwork used by
the Codex plugin and advertised in MCP `serverInfo.icons`. The source path,
dimensions, MIME type, and SHA-256 digest are pinned in the Worker source and
covered by its tests.

Keep the square connector icon separate from the hosted authorization experience. The
consent, callback, privacy, and deletion pages use the exact
["Works with YNAB" integration mark](https://api.ynab.com/papi/works_with_ynab.svg)
that YNAB permits under section 5.3 of its
[API Terms](https://api.ynab.com/#terms). The unchanged SVG is available at
`https://ynab.amesvt.com/assets/works-with-ynab.svg`.

YNAB's terms expressly permit the integration mark and the "for YNAB" naming
form. The square Codex-matched connector icon is documented as a separate
repository branding choice rather than as a Terms-permitted integration asset.
Every hosted page includes YNAB's required non-affiliation and trademark notice.

## Items still needed before submission

- Oliver's explicit approval to make the connector publicly discoverable.
- Team or Enterprise Directory management access in Claude.ai.
- A populated YNAB test account and reviewer instructions. Do not put test
  credentials in this repository.
- A final end-to-end test in Claude.ai that connects through OAuth, confirms the
  tool list, and runs representative read-only calls.
- A Restricted Mode rollout decision. YNAB exempts the application owner but
  limits the app to 25 access tokens for other users, then prohibits new
  authorizations. Its current documentation says review takes 2 to 4 weeks.
  Do not submit that review or this directory listing without Oliver's explicit
  approval.

Anthropic's [submission guide](https://claude.com/docs/connectors/building/submission)
was checked on July 15, 2026. It says the portal has a dedicated icon field and
requires server, tool, OAuth, privacy, use case, data handling, test account, and
compliance details. YNAB's API Terms were last updated May 28, 2025.
