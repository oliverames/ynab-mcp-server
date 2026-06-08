# Hosted OAuth Connector Pattern

This package is a local stdio MCP server. A hosted connector should not ask users for a YNAB personal access token. It should follow an OAuth authorization-code flow, store per-user YNAB tokens server-side, and expose MCP over HTTPS.

## Target Architecture

Use a Cloudflare Worker or equivalent edge service with these routes:

| Route | Purpose |
|---|---|
| `/mcp` | MCP endpoint served by the hosted connector. Requires a valid connector grant. |
| `/authorize` | Starts the connector OAuth flow and renders consent. |
| `/callback` | Receives the YNAB authorization code and completes the connector authorization. |
| `/token` | Issues connector access tokens to MCP hosts. |
| `/register` | Dynamic client registration, if the host supports it. |
| `/privacy` | Public privacy policy. |
| `/delete` | User-facing data deletion and grant revocation flow. |

The Smirnovlabs-style Cloudflare pattern is a good fit: wrap the MCP handler in an OAuth provider, use a stateful MCP agent for authenticated sessions, and keep the YNAB OAuth token refresh path separate from tool registration. Composio-style hosted connectors use the same core shape: hosted OAuth, per-user token vaulting, and a remote MCP endpoint instead of user-supplied PATs.

## YNAB OAuth Requirements

Use YNAB OAuth instead of personal access tokens:

- Authorization URL: `https://app.ynab.com/oauth/authorize`
- Token URL: `https://app.ynab.com/oauth/token`
- Response type: `code`
- PKCE: `S256` code challenge and verifier
- Scope: use the minimum viable scope. Prefer read-only unless the hosted connector explicitly offers write tools.

Required hosted environment values:

| Variable | Purpose |
|---|---|
| `YNAB_OAUTH_CLIENT_ID` | YNAB OAuth application client ID. |
| `YNAB_OAUTH_CLIENT_SECRET` | YNAB OAuth application secret. Store only in the host secret manager. |
| `YNAB_OAUTH_SCOPE` | Requested YNAB OAuth scope. |
| `CONNECTOR_BASE_URL` | Public connector origin, for redirect URL construction. |
| `TOKEN_KV` | Durable KV/DB binding for encrypted YNAB access and refresh tokens. |
| `OAUTH_STATE_KV` | Short-lived state storage for authorization requests. |

## Safety Model

Carry the local safety model into the hosted connector:

1. Register read tools by default.
2. Register write tools only when the connector grant, deployment config, and requested YNAB scope all allow writes.
3. Annotate read tools with `readOnlyHint: true`.
4. Annotate write tools with `readOnlyHint: false`, and use `destructiveHint: true` for delete tools.
5. Pin outbound YNAB HTTP traffic to `https://api.ynab.com`; reject redirects and non-YNAB hosts.
6. Redact `Authorization`, bearer tokens, access tokens, and refresh tokens from logs and MCP errors.
7. Add a delete-data flow that revokes connector grants and removes stored YNAB tokens.

## OAuth State Handling

The authorization flow should bind state to both server-side storage and a browser cookie:

1. Generate a random OAuth `state`.
2. Generate a PKCE verifier and `S256` challenge.
3. Store `{ state, verifier, redirect_uri, client_id, scope }` with a 10-minute TTL.
4. Set an HttpOnly, Secure, SameSite=Lax cookie containing a SHA-256 hash of `state`.
5. On `/callback`, require the query `state`, the stored state record, and the cookie hash to match.
6. Delete the state record after first use.

This prevents replay and cross-tab confusion while keeping the YNAB token exchange server-side.

## Token Lifecycle

The hosted connector should store tokens by connector user or YNAB user ID:

- On callback, exchange the code for YNAB access and refresh tokens.
- Fetch the YNAB user profile immediately and persist the YNAB user ID with the token record.
- Refresh tokens before expiry, with a small safety window such as 60 seconds.
- If refresh fails, delete the stale token record and require reauthorization.
- Never expose YNAB access or refresh tokens to the MCP host or model context.

## Deployment Checklist

- Create and verify a YNAB OAuth application with the production redirect URI.
- Decide whether the hosted connector offers read-only only, read/write, or separate read-only and write-enabled variants.
- Publish privacy, support, and deletion pages before public distribution.
- Include a public support contact for account, deletion, and security questions.
- Configure the OAuth app with a privacy policy URL and display that URL clearly in the connector interface.
- Use public names and DNS names that follow the "for YNAB" pattern and do not imply sponsorship, endorsement, or official YNAB support.
- Add non-affiliation language; this connector is not an official YNAB product.
- Run read-only smoke tests through `/mcp`.
- If writes are enabled, run the batch category+approval smoke against a dedicated test budget and assert post-write refetch verification.
- Require `confirmed: true` for destructive direct tools, bulk-filter write tools, and any generic write executor.
