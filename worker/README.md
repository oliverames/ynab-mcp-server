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
  full 58-domain-tool surface plus four discovery/executor helpers via
  `createYnabServer()` from [`../index.js`](../index.js),
  tools, prompts, resources, host pinning, and `confirmed:true` gates are the
  exact code the local stdio server runs. Every tool also returns the same
  app-client contract: human-readable title, input/output schemas, matching
  `structuredContent`, and private/bounded impact hints.
- The consent page redirects to YNAB's own OAuth with PKCE S256. Consent and
  callback state use 192-bit opaque values, keyed hashes, one-time KV records,
  and 10-minute TTLs without depending on browser cookies. Access tokens last 2
  hours; refresh happens automatically inside a 60-second safety window;
  refresh tokens rotate and are persisted per YNAB user in KV. Users choose
  read-only vs write access at consent (`read-only` scope vs no scope).
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

New YNAB OAuth apps run in
[Restricted Mode](https://api.ynab.com/#oauth-applications). The app owner is
exempt, but the application can obtain at most 25 access tokens for other users
before YNAB blocks new authorizations. Removing the limit requires YNAB's
review, which its current documentation says takes 2 to 4 weeks. This is a
rollout limit, not a cause of connector consent errors that happen before the
browser reaches YNAB.
Do not submit the review form or publish the connector without Oliver's explicit
approval.

## Connector identity

The Worker serves YNAB's permitted, unmodified
["Works with YNAB" mark](https://api.ynab.com/papi/works_with_ynab.svg) at
`/assets/works-with-ynab.svg` and an equivalent 196x78 PNG rendering at
`/assets/works-with-ynab.png`. Hosted consent, callback, privacy, and deletion
pages use this mark and carry the required non-affiliation and trademark
language.

For connector discovery, MCP `initialize` advertises the current 1024x1024 YNAB
iOS App Store icon at `/assets/ynab-app-icon.png` in `serverInfo.icons`. The
landing page publishes the same PNG as its favicon and Open Graph image. Its
source listing, source artwork URL, dimensions, MIME type, and SHA-256 digest
are pinned in `src/brand-assets.js` and `src/ynab-app-icon-png.js` and covered by
the Worker tests.

YNAB's API Terms expressly permit the integration mark and the "for YNAB"
naming form. They do not expressly grant general permission to reuse YNAB's
consumer app artwork; the app-list icon is therefore documented as a separate
branding choice rather than as a Terms-permitted integration asset.

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

The unit suite is credential-free. Production acceptance passed on July 15,
2026, in ChatGPT, Claude.ai, and Mistral Vibe Work. Each host signed in through
YNAB, invoked the connector, returned the live budget list, and reported
`writes_enabled: true` for the explicitly write-authorized grant. No acceptance
chat performed a financial mutation; an actual write/undo exercise still
requires separate approval for the exact operation.
