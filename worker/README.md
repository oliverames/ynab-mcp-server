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
  full 58-tool surface via `createYnabServer()` from [`../index.js`](../index.js),
  tools, prompts, resources, host pinning, and `confirmed:true` gates are the
  exact code the local stdio server runs.
- The consent page redirects to YNAB's own OAuth (PKCE S256, state bound to a
  keyed cookie HMAC, 10-minute TTL). Access tokens last 2 hours; refresh happens
  automatically inside a 60-second safety window; refresh tokens rotate and are
  persisted per YNAB user in KV. Users choose read-only vs write access at
  consent (`read-only` scope vs no scope).
- YNAB tokens and undo journals are encrypted with AES-GCM before they enter KV.
  The encryption key is separate from the cookie-signing key.
- The undo journal is scoped to each YNAB user; `/delete` proves identity with a
  fresh YNAB sign-in, then purges tokens, journal entries, and every paginated
  connector grant.

## Deploy

```bash
cd worker
npm install
npx wrangler kv namespace create OAUTH_KV     # paste id into wrangler.jsonc
npx wrangler secret put YNAB_CLIENT_ID        # from the YNAB OAuth application
npx wrangler secret put YNAB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY # any random 32+ byte string
npx wrangler secret put DATA_ENCRYPTION_KEY   # a different random 32+ byte string
npx wrangler deploy                           # provisions ynab.amesvt.com DNS + cert
```

Prerequisites: a YNAB OAuth application (YNAB → Account Settings → Developer
Settings) whose redirect URI is exactly `https://ynab.amesvt.com/callback`, and
wrangler authenticated against the Cloudflare account that owns the amesvt.com
zone. Local dev: copy `.dev.vars.example` to `.dev.vars` (redirect URI
`http://localhost:8787/callback` must also be registered on the YNAB app while
testing locally).

New YNAB OAuth apps run in Restricted Mode (25 user authorizations) until a
"Works with YNAB" review. That limit is fine while this connector stays unlisted.

## Connector identity

The Worker serves YNAB's permitted, unmodified
["Works with YNAB" mark](https://api.ynab.com/papi/works_with_ynab.svg) at
`/assets/works-with-ynab.svg` and an equivalent 196x78 PNG rendering at
`/assets/works-with-ynab.png`. The MCP `initialize` response advertises both
same-origin URLs in `serverInfo.icons`, with PNG first because MCP icon clients
must support PNG and only should support SVG. The landing page also publishes
the same assets as favicons for hosts that discover connector art that way.

YNAB's API Terms permit this integration mark and the "for YNAB" naming form.
They do not grant general permission to reuse YNAB's consumer app icon or other
brand artwork, so those are intentionally not bundled. Every hosted page carries
YNAB's required non-affiliation and trademark language.

Custom connectors may ignore MCP icon metadata or cached favicon changes. A
Connectors Directory listing has a separate icon field, but public submission is
not part of deployment and must be handled as its own review and publication
decision.

## Verify

```bash
npm test
npx wrangler deploy --dry-run
curl -I https://ynab.amesvt.com/
curl -I https://ynab.amesvt.com/assets/works-with-ynab.png
curl https://ynab.amesvt.com/.well-known/oauth-protected-resource/mcp
curl https://ynab.amesvt.com/.well-known/oauth-authorization-server
```

The unit suite is credential-free. A complete production smoke also connects an
OAuth-capable MCP client, signs in to YNAB, lists tools, and runs a read-only
request before any write testing.
