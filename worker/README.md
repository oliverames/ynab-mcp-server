# ynab-mcp-connector (worker/)

Cloudflare Worker that hosts the same MCP server as the repo root, remotely at
**https://ames-ynab.link/mcp**, with per-user YNAB OAuth instead of a personal
access token. Design blueprint: [docs/hosted-oauth-connector.md](../docs/hosted-oauth-connector.md).
Not affiliated with YNAB.
Domain changes follow the [cutover, retirement, and rollback runbook](../docs/domain-migration.md).

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
  callback state use 192-bit opaque values, keyed hashes, atomic Durable Object records,
  and 10-minute TTLs without depending on browser cookies. Access tokens last 2
  hours; refresh happens automatically inside a 60-second safety window;
  refresh tokens rotate and are persisted per consent credential. Users choose
  read-only vs write access at consent (`read-only` scope vs no scope).
- YNAB tokens and operation/undo journals are encrypted with AES-GCM before they
  enter the credential Durable Object's storage. One object per YNAB user
  serializes refresh and deletion; separate consent credentials bind the client
  ID and read/write choice. Different clients never share an upstream token.
  The encryption key is separate from the cookie-signing key.
- Each consent has its own journal, with revision checks and journal-only CAS
  retries to protect concurrent MCP sessions. `/delete` proves identity with a
  fresh YNAB sign-in, then purges all the user's consent credentials, journals,
  old shared KV records, and every paginated connector grant.

Deletion retains only a non-financial generation marker inside the credential
object so a final-consent form displayed before deletion cannot recreate its
credentials afterward. A concurrent provider completion is rejected and its
exact grant is revoked when visible; the provider's eventually consistent KV
listing can leave an unusable grant until expiry or a repeated deletion. Its
removed credential cannot authorize a YNAB API request.

## Connector icons

Hosted MCP initialization publishes `serverInfo.icons` using the supported
`2025-11-25` protocol: the official YNAB tree as a genuine SVG, a transparent
4096 × 4096 PNG rendered directly from that vector, and a small 256 × 256 PNG
fallback. Icon URLs use the configured connector origin. The versioned public
routes are `/assets/ynab-tree-icon-v2.svg` and `/assets/ynab-tree-icon-v2.png`;
the existing `/assets/ynab-tree-icon-v1.png` remains available.

The source artwork and its attribution are retained in
[`assets/ynab-tree-blurple.svg`](../assets/ynab-tree-blurple.svg). Regenerate the
embedded assets with `npm run build:worker-icons` from the repository root.
Existing favicons, Apple touch icons and the Codex app icon retain their bytes.

Clients may choose a separate logo source. Gemini's installed image cache has
Google `/s2/favicons` requests for existing custom connectors; on October 11,
2026, that service returned a generic globe for `ames-ynab.link` while the
origin served valid tree icons. Some machine user agents also received an edge
`403` on public assets. This metadata update does not change Cloudflare rules,
Google's favicon cache, or a client's saved logo. Verify the actual client after
publication without disconnecting its working authorization.

## Credential isolation migration (issue #32)

The `v3` Wrangler migration adds the `OAuthCredentials` Durable Object and
`YNAB_CREDENTIALS` binding. Deploying this reviewed code is a separate action;
the implementation and tests do not deploy or create an authorization grant.

All existing grants without `credentialVersion: 2` and a consent credential ID
become discovery-only and show a reconnect instruction. Reconnect each MCP
client and approve its required access. The old per-user token cannot establish
which client and scope produced it, so it is never adopted by a new grant. Its
encrypted token and undo records remain inaccessible in KV until the user uses
`/delete`; they cannot safely become another client's undo history. New consent
stores a unique credential and rollback removes only that credential. The OAuth
provider's replacement policy retains other clients' grants; temporary domain
compatibility also retains the same client's grants for other connector origins.
Removing the old domain does not delete those stored grants or credentials.

MCP Durable Object addresses also include the authenticated consent identity.
A different client's valid token and a disclosed MCP session ID cannot attach
to the original session. Opening a new MCP session with the same grant can
recover its journal after fresh approval. Replacing a consent creates a new
isolated journal; it cannot automatically adopt a prior consent's unfinished
operation. Reconcile such an operation directly in YNAB if its old grant is no
longer usable, instead of blindly repeating the move or merge.

The private credential object serializes refresh across MCP sessions, but a
successful upstream rotation followed by a lost response or storage failure can
still require reauthorization. It does not make YNAB OAuth or financial writes
transactional. New ordinary budget caches and previews live only in the MCP
session's memory; durable operation records retain relevant before/after values
for recovery and undo, and are encrypted with the journal.
Encrypted journals use atomically committed 512 KiB ciphertext chunks, with a
16 MiB encrypted-journal bound, to avoid SQLite's single-value storage limit.
Storage failures are surfaced; they never authorize an automatic financial retry.

The agent's optional durable MCP response replay is disabled so ordinary
financial response bodies and previews are not saved as stream events. If a
stream disconnects, clients can reconnect and request fresh reads. A write with
an uncertain result requires the encrypted operation journal, a fresh preview,
and explicit approval before recovery.

## Deploy

For the existing hosted service, follow the [domain migration runbook](../docs/domain-migration.md).
Keep its existing namespace, Durable Objects, and secrets. The initialization
commands below are for a new installation; do not repeat them during migration.

```bash
cd worker
npm install
npx wrangler kv namespace create OAUTH_KV     # paste id into wrangler.jsonc
npx wrangler secret put YNAB_CLIENT_ID        # from the YNAB OAuth application
npx wrangler secret put YNAB_CLIENT_SECRET
npx wrangler secret put COOKIE_ENCRYPTION_KEY # any random 32+ byte string
npx wrangler secret put DATA_ENCRYPTION_KEY   # a different random 32+ byte string
npx wrangler deploy                           # provisions configured domains + certs
```

After any deploy, run `npm run smoke:hosted` from the repository root. It signs in with the one-time consent token kept in 1Password and verifies the live tools, version and instructions (see the root README's "Hosted Connector Smoke Test" for the one-time `npm run smoke:hosted:consent` step).

Prerequisites: a YNAB OAuth application (YNAB → Account Settings → Developer
Settings) with `https://ames-ynab.link/callback` registered, and Wrangler
authenticated against the Ames Consulting account that owns the new zone.
The approved cutover temporarily retained the old hostname; the final deployment
retired its custom domain, DNS record, and YNAB callback. The saved callback list contains
`https://ames-ynab.link/callback` and `http://localhost:8787/callback`.
Local dev: copy `.dev.vars.example` to `.dev.vars` (redirect URI
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

## Canonical origin and temporary compatibility

`CONNECTOR_BASE_URL` is the canonical public origin, now `https://ames-ynab.link`.
Final Worker version `f98c174c-eb6e-4b55-8159-b9ca522adfaa` serves only the new
custom domain with `CONNECTOR_COMPATIBILITY_ORIGINS` empty. The old custom
domain, its managed DNS record, and its YNAB callback are removed and verified.
`CONNECTOR_COMPATIBILITY_ORIGINS` is an optional comma-separated list of other
exact connector origins served on the same Worker. The first cutover deployment
temporarily used the following configuration for validation and rollback:

```json
{
  "CONNECTOR_BASE_URL": "https://ames-ynab.link",
  "CONNECTOR_COMPATIBILITY_ORIGINS": "https://ynab.amesvt.com"
}
```

Use HTTPS origins with no path, query, fragment, or credentials; HTTP loopback
origins are supported only for local development. The Worker accepts only these
configured connector origins and returns `421` for an unconfigured origin.
Public canonical links use `CONNECTOR_BASE_URL`, while each supported request
origin retains its own OAuth issuer, exact `/mcp` resource, and origin-bound
consent/callback flow. A compatibility origin serves MCP and OAuth directly
without redirecting existing clients to the canonical domain. Oliver's requested
endstate retires `ynab.amesvt.com` after the replacement passes live checks;
clients must reconnect at `https://ames-ynab.link/mcp` and approve a new consent.
The old origin is not a permanent endpoint.

The approved retirement removed the old custom-domain mapping, connector-managed
DNS record, and Wrangler route. The current production configuration is:

```json
{
  "CONNECTOR_BASE_URL": "https://ames-ynab.link",
  "CONNECTOR_COMPATIBILITY_ORIGINS": ""
}
```

The old `https://ynab.amesvt.com/callback` is removed from the existing YNAB
OAuth application. Preserve stored grants, credentials, encrypted
journals, all bindings and secrets, and renewal settings. Keep the old code
version and routing/OAuth settings available for rollback through validation;
once new clients exist, a rollback must preserve the new issuer too.

Local Wrangler forwards the configured route's hostname by default. For
credential-free loopback runtime checks, override that upstream hostname too:

```bash
npx wrangler dev --local --host localhost:8787 --upstream-protocol http \
  --var CONNECTOR_BASE_URL:http://localhost:8787 \
  --var CONNECTOR_COMPATIBILITY_ORIGINS:
```

During temporary both-host operation, keep each configured hostname attached to
`ynab-mcp-connector` as an exact Cloudflare custom domain and retain its exact
YNAB `/callback` URI. The separate
`MCP_ALLOWED_ORIGINS` variable lists browser client origins such as
`https://chatgpt.com`; it does not grant connector aliases. See
[the migration runbook](../docs/domain-migration.md) before adding a domain,
changing published URLs, or retiring an old issuer.

## Connector identity

The Worker serves YNAB's permitted, unmodified
["Works with YNAB" mark](https://api.ynab.com/papi/works_with_ynab.svg) at
`/assets/works-with-ynab.svg` and an equivalent 196x78 PNG rendering at
`/assets/works-with-ynab.png`. Hosted consent, callback, privacy, and deletion
pages use this mark and carry the required non-affiliation and trademark
language.

For connector discovery, MCP `initialize` advertises the Blurple tree vector
first, followed by a 4096px PNG and a small 256px PNG fallback. The versioned
vector and high-resolution routes are described under Connector icons above.
The existing 1024x1024 `/assets/icon.png` continues to match the Codex plugin
artwork and remains the landing page's Open Graph image. Conventional
ICO, 16px, 32px, 48px, 64px, 96px, 128px, 256px, and Apple touch icon routes
use the Blurple YNAB tree artwork from `assets/ynab-tree-blurple.svg`, downloaded
from YNAB's public Webflow CDN asset. The ICO uses one 32px frame and stays below
10 KiB for clients that skip larger ICO responses. The Claude-facing 256px PNG
is forced to 8-bit RGBA and served from the
versioned `/assets/ynab-tree-icon-v1.png` route so a previously rejected image
cannot remain pinned by the immutable asset cache. The generator, dimensions,
MIME types, and
SHA-256 digests are pinned in source and covered by the Worker tests.

YNAB's API Terms expressly permit the integration mark and the "for YNAB"
naming form. The tree and Codex square icons are separate branding assets; the Terms'
express permission applies to the integration mark. The source attribution
and existing non-affiliation text remain intact.

Custom connectors may ignore MCP icon metadata or cached favicon changes. A
Connectors Directory listing has a separate icon field, but public submission is
not part of deployment and must be handled as its own review and publication
decision.

## Verify

```bash
npm test
npx wrangler deploy --dry-run
curl -I https://ames-ynab.link/
curl -I https://ames-ynab.link/assets/works-with-ynab.png
curl https://ames-ynab.link/.well-known/oauth-protected-resource/mcp
curl https://ames-ynab.link/.well-known/oauth-authorization-server
```

The unit suite is credential-free. Production acceptance passed on July 15,
2026, in ChatGPT, Claude.ai, and Mistral Vibe Work. Each host signed in through
YNAB, invoked the connector, returned the live budget list, and reported
`writes_enabled: true` for the explicitly write-authorized grant. No acceptance
chat performed a financial mutation; an actual write/undo exercise still
requires separate approval for the exact operation.

## Troubleshooting: the client shows read tools but no write tools

Write tools are gated **per connection, at consent time** — not by a server
setting you can change after the fact. If the `writes` box on the connector's
consent screen was left unchecked, YNAB issues a read-only token, the grant
scope is `["read"]`, and the write tools are never registered for that session,
so a correct client (ChatGPT, Claude.ai, etc.) simply does not list them. This
is by design, not a bug.

To confirm which case you are in, ask the client to call **`ynab_auth_status`**
(a read tool, always available). It reports:

- `writes_enabled` — `false` means this connection is read-only.
- `write_enablement` — host-specific instructions for turning writes on.

**To enable writes:** disconnect/remove the YNAB connector in your client, add
it again, and on the YNAB consent screen **check "Allow write access."** New
grants always default to read-only, so the box must be checked on every fresh
authorization. After reconnecting, `ynab_auth_status` should report
`writes_enabled: true` and the update/create tools should appear.

**Client enablement caveat:** some clients require a developer/beta mode, or
workspace-admin approval, before they will expose or invoke custom-connector
write tools — independent of the YNAB grant. (In ChatGPT, custom-MCP write
actions run through developer mode and prompt for per-action approval.) If
`writes_enabled: true` but the client still will not call a write tool, this is
a client-side enablement issue, not a connector defect — verify the server side
independently with the MCP Inspector or a direct `tools/call`.
