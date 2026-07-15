# ynab-mcp-connector (worker/)

Cloudflare Worker that hosts the same MCP server as the repo root, remotely at
**https://ynab.amesvt.com/mcp**, with per-user YNAB OAuth instead of a personal
access token. Design blueprint: [docs/hosted-oauth-connector.md](../docs/hosted-oauth-connector.md).
Not affiliated with YNAB.

## How it works

- [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
  is the OAuth 2.1 server MCP clients talk to (`/authorize`, `/token`, `/register`);
  grants live in KV with props encrypted and tokens stored hash-only.
- [`McpAgent`](https://developers.cloudflare.com/agents/) (SQLite Durable Object)
  serves `/mcp` (streamable HTTP) and `/sse` (legacy). Each session builds the
  full 58-tool surface via `createYnabServer()` from [`../index.js`](../index.js) —
  tools, prompts, resources, host pinning, and `confirmed:true` gates are the
  exact code the local stdio server runs.
- The consent page redirects to YNAB's own OAuth (PKCE S256, state bound to a
  cookie hash, 10-minute TTL). Access tokens last 2 hours; refresh happens
  automatically inside a 60-second safety window; refresh tokens rotate and are
  persisted per YNAB user in KV. Users choose read-only vs write access at
  consent (`read-only` scope vs no scope).
- The undo journal is KV-backed per YNAB user; `/delete` proves identity with a
  fresh YNAB sign-in, then purges tokens, journal, and grants.

## Deploy

```bash
cd worker
npm install
npx wrangler kv namespace create OAUTH_KV     # paste id into wrangler.jsonc
npx wrangler secret put YNAB_CLIENT_ID        # from the YNAB OAuth application
npx wrangler secret put YNAB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY # any random 32+ byte string
npx wrangler deploy                           # provisions ynab.amesvt.com DNS + cert
```

Prerequisites: a YNAB OAuth application (YNAB → Account Settings → Developer
Settings) whose redirect URI is exactly `https://ynab.amesvt.com/callback`, and
wrangler authenticated against the Cloudflare account that owns the amesvt.com
zone. Local dev: copy `.dev.vars.example` to `.dev.vars` (redirect URI
`http://localhost:8787/callback` must also be registered on the YNAB app while
testing locally).

New YNAB OAuth apps run in Restricted Mode (25 user authorizations) until a
"Works with YNAB" review — fine while this connector stays unlisted.
