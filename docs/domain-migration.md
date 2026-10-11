# Hosted connector domain migration

The approved migration is deployed. [PR #35](https://github.com/oliverames/ynab-mcp-server/pull/35)
merged as `674b88c`, and the first two-host production deployment is Worker
version `2763a745-8f0f-4a34-8d86-8d59ad3bd87c`. Final source commit
`2e3277a4fbe698e77633fa26d8a0fc5bc583f2f6`
is deployed as Worker version `f98c174c-eb6e-4b55-8159-b9ca522adfaa`, accepting
only `ames-ynab.link`. Cloudflare readback shows only that custom domain with
Workers.dev and preview endpoints disabled. YNAB callback readback retains
only `http://localhost:8787/callback` and `https://ames-ynab.link/callback`;
the application website and privacy URLs use the new origin. Signed-in
Cloudflare DNS search for `ynab` in `amesvt.com` shows no DNS records: final
deployment automatically removed the old managed record and custom domain.
Old-domain retirement is verified.
Its [CI run `38154790327`](https://github.com/oliverames/ynab-mcp-server/actions/runs/38154790327)
passed all nine checks.

On October 11, 2026, the signed-in
Cloudflare account showed the active zone `ames-ynab.link`, with no Worker
attached, and the registration email independently corroborated that hostname
and its October 11, 2027 expiry. The supplied purchase screenshot could not be
materialized after two supported attempts. Oliver subsequently confirmed
`ames-ynab.link` and approved the live cutover and old-domain retirement scope
recorded below.
Do not change the domain's renewal settings.

Oliver's requested endstate is to retire the YNAB connector from
`ynab.amesvt.com` after `ames-ynab.link` is verified. Both-host operation is a
temporary cutover and rollback stage. Clients must reconnect at
`https://ames-ynab.link/mcp`; the old domain is not a permanent endpoint.

Before cutover, the new zone had zero DNS records, no custom or rate-limiting rules, and an
active Universal TLS certificate for `ames-ynab.link` and `*.ames-ynab.link`
(managed expiry January 9, 2027). Browser Integrity Check is enabled and Bot
Fight Mode was disabled. These are the saved pre-cutover dashboard observations.
The approved new-host rate limit and narrow Browser Integrity Check exception
are now active, as recorded below; unrelated protection controls remain intact.

The verified starting deployment is release `6.0.1`, source commit
`1b2f0411d7886caddcf81f1d31f42706c9483ec0`, Cloudflare Worker version
`ea1eeb0e-d5f0-4336-b413-97c406dc254b` for `ynab-mcp-connector`.
Recheck that version and concurrent deployments immediately before cutover.

## Endpoint inventory

The right-hand column is the canonical deployed origin. Independent endpoint
and policy checks passed with valid TLS. The former public `/` and `/mcp`
returned Cloudflare `530` / `1016` after detachment. Subsequent signed-in DNS
readback confirms that the old managed record is absent.

| Surface | Former URL | Canonical URL |
|---|---|---|
| Landing page | `https://ynab.amesvt.com/` | `https://ames-ynab.link/` |
| Streamable HTTP MCP | `https://ynab.amesvt.com/mcp` | `https://ames-ynab.link/mcp` |
| Legacy SSE | `https://ynab.amesvt.com/sse` | `https://ames-ynab.link/sse` |
| Connector authorization | `https://ynab.amesvt.com/authorize` | `https://ames-ynab.link/authorize` |
| YNAB callback | `https://ynab.amesvt.com/callback` | `https://ames-ynab.link/callback` |
| Connector token exchange | `https://ynab.amesvt.com/token` | `https://ames-ynab.link/token` |
| Client registration | `https://ynab.amesvt.com/register` | `https://ames-ynab.link/register` |
| Authorization server discovery | `https://ynab.amesvt.com/.well-known/oauth-authorization-server` | `https://ames-ynab.link/.well-known/oauth-authorization-server` |
| Protected resource discovery | `https://ynab.amesvt.com/.well-known/oauth-protected-resource/mcp` | `https://ames-ynab.link/.well-known/oauth-protected-resource/mcp` |
| Privacy | `https://ynab.amesvt.com/privacy` | `https://ames-ynab.link/privacy` |
| Data deletion | `https://ynab.amesvt.com/delete` | `https://ames-ynab.link/delete` |
| Favicon | `https://ynab.amesvt.com/favicon.ico` | `https://ames-ynab.link/favicon.ico` |

## Temporary compatibility contract

During cutover, keep both exact custom domains on the **same Worker**. Set
`CONNECTOR_BASE_URL` to the confirmed canonical HTTPS origin and set
`CONNECTOR_COMPATIBILITY_ORIGINS=https://ynab.amesvt.com`. The first production
cutover deployment used that temporary configuration. The final deployed
configuration in `worker/wrangler.jsonc` keeps only `ames-ynab.link` in `routes`
and clears `CONNECTOR_COMPATIBILITY_ORIGINS`.
Origins contain no credentials,
path, query, or fragment; never infer an accepted origin from request headers.
Keep `workers_dev` disabled.

Each allowed origin has its own OAuth provider metadata: its issuer and
authorization/token/registration endpoints remain on that origin, and its MCP
resource and accepted audience are exactly `<that-origin>/mcp`. Consent,
callback, PKCE state, and final confirmation must stay bound to the origin
where authorization began. An old-origin token is not a new-origin token.
Verify this boundary in tests before deployment.

Serve the old `/mcp`, `/sse`, discovery, OAuth, callback, and deletion routes
directly during validation. Do not add cross-domain redirects to these routes.
Existing clients remain usable during this stage. They must reconnect at the
new URL and complete a new consent; the old URL stops working at retirement.
Do not rewrite registered MCP-client redirect URIs: those are host-owned
destinations. Only the connector's upstream YNAB callback list
needs the additional exact URI. Reconnecting the same client replaces only its
grants for the same exact resource origin; a new-origin consent must not revoke
the client's existing old-origin grant. Retirement removes access through the
old domain without deleting its stored grants, credentials, or encrypted
journals. New consent does not automatically adopt another consent's journal;
reconcile any uncertain old-consent operation before repeating it.

Preserve the existing Worker name, `OAUTH_KV` namespace, `MCP_OBJECT`,
`OAUTH_STATE`, and `YNAB_CREDENTIALS` bindings, Durable Object migration history,
and all four secrets. Do not copy token records, rotate keys, revoke grants,
reset storage, or adopt another consent's encrypted journal. The domain change
must preserve the existing per-user and per-consent credential isolation.
`MCP_ALLOWED_ORIGINS` is the separate browser-client allowlist, not a list of
connector domain aliases.

## Staged cutover

1. Recheck the confirmed hostname's zone and registrar ownership in the
   signed-in Cloudflare account.
   Inspect conflicting DNS, Worker routes, certificate state, and zone security
   rules. Save the old custom-domain/DNS settings, callback allowlist, runtime
   configuration, and deployment version for rollback, plus before screenshots
   of the old landing page, favicon, and Worker domains.
2. Complete and review origin-scoped runtime tests. Stage both exact custom
   domains in `worker/wrangler.jsonc`, the canonical/compatibility variables,
   canonical public links and brand metadata, and hosted connector documentation.
   PR #35 merged the reviewed cutover code and canonical links as `674b88c`.
3. The approved live-change scope is: attach the confirmed
   hostname to `ynab-mcp-connector` while temporarily retaining
   `ynab.amesvt.com`; add
   `https://ames-ynab.link/callback` to the existing YNAB OAuth application
   while retaining `https://ynab.amesvt.com/callback`; and apply any required
   hostname-scoped edge rules described below. Include the exact retirement
   targets below, to be applied only after the new origin passes acceptance.
   If the OAuth application cannot retain both callbacks during cutover, stop
   and report that constraint before changing it.
4. Apply the approved exact YNAB callback addition and custom domain, preserving
   existing settings. Cloudflare Custom Domains provision routing and a
   hostname certificate; inspect activation before publishing the new URL.
   [Cloudflare's Custom Domains documentation](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
   describes the exact-host routing and certificate behavior.
5. Inspect the actual new-zone protections and compare automation user agents.
   If Browser Integrity Check blocks machine endpoints, propose an exception
   scoped to the confirmed host and MCP/discovery, registration, and token
   paths. Pair public `/register` with its IP rate limit. Apply any security
   exception only after its required action-time approval. Keep consent pages
   and other zone protections intact. See
   [the existing edge configuration](hosted-oauth-connector.md#edge-configuration-cloudflare).
6. Deploy the reviewed compatible code and configuration, then run the acceptance
   checks below on **both** origins. Publish the canonical new URLs only after
   they pass. Capture after screenshots and record commit, Cloudflare version,
   exact endpoint URLs, results, and any deferred live authorization check.
7. Verify the new origin's public endpoint/discovery checks and the saved
   server-side YNAB callback configuration, then perform the approved old-domain
   retirement below. Give Oliver `https://ames-ynab.link/mcp` to enter himself.
   Oliver will migrate his client connector configurations; do not edit them or
   make their migration a service-deployment completion gate. Report any
   deferred signed-in read-only check separately.

### Verified edge changes

The old zone's existing MCP exception skips **only Browser Integrity Check**,
with logging enabled, and its registration limit blocks an IP exceeding 10
requests per 10 seconds for 10 seconds. Those settings were read in the signed-in
dashboard; its shared rules also cover unrelated services and must remain intact.
The new-host comparison returned Cloudflare `1010` for Python-urllib/3.11,
confirming that the approved narrow exception was needed. Rule
`94bb62a40ade4c44905caf2da19692f7` is now saved and active with this exact
new-host expression:

```text
(http.host eq "ames-ynab.link" and (http.request.uri.path in {"/mcp" "/sse" "/register" "/token"} or starts_with(http.request.uri.path, "/.well-known/") or starts_with(http.request.uri.path, "/register/")))
```

Verified action: Skip **Browser Integrity Check only**, log matching requests
enabled. Python-urllib/3.11 now receives HTTPS `200` for the authorization-server
discovery document, whose issuer and authorization/token/registration endpoints
all use `ames-ynab.link`, and `/mcp` returns its proper `401` and resource-metadata
challenge. HSTS is `max-age=31536000`. Leave
managed rules, other custom rules, rate limiting, Bot Fight Mode, Security Level,
and browser consent/callback pages under their current protections.

The active registration rate-limit rule `d95d0e4938ee47aea353617a2a5cbe4c`
matches
`http.host eq "ames-ynab.link" and http.request.uri.path eq "/register"`, keyed
by IP, threshold **10 requests / 10 seconds**, action **Block / 10 seconds**.
The bounded 16-request concurrent empty-POST check returned 12 application `400`
responses and four Cloudflare `429` / `1015` responses.
Missing `redirect_uris` prevented OAuth client creation. This confirms observed
rate-limit enforcement; distributed counters do not guarantee rejection of
exactly the eleventh request. Session evidence is retained outside the repository
as `register-rate-check.json`.
No edits to `amesvt.com` rules, domain
renewal, or unrelated hostnames are part of this migration.

### Approved retirement changes and readback

The final Worker configuration and custom-domain retirement are deployed.
Cloudflare shows only `ames-ynab.link`; the YNAB application retains exactly the
new production callback and localhost development callback. Its website is
`https://ames-ynab.link` and privacy URL is `https://ames-ynab.link/privacy`.
Existing budget settings, Terms acceptance, keys, and grants remain unchanged.
The old connector-managed DNS record is absent in the signed-in `amesvt.com`
DNS search, completing retirement readback. Session screenshot evidence is
retained outside the repository as `old-dns-after.jpg`.

The approved retirement targets and consequences are:

- Remove the `ynab.amesvt.com` custom-domain mapping from
  `ynab-mcp-connector`, then verify that its connector-managed DNS record is
  removed; delete that exact remaining record only if Cloudflare leaves it
  behind. Keep the `amesvt.com` zone and unrelated DNS/rules intact. Existing
  clients configured with the old URL will lose connectivity and must reconnect
  at `https://ames-ynab.link/mcp`.
- Remove `ynab.amesvt.com` from `worker/wrangler.jsonc` routes and clear
  `CONNECTOR_COMPATIBILITY_ORIGINS` after validation. Keep
  `CONNECTOR_BASE_URL=https://ames-ynab.link`; the final deployment accepts only
  the new connector origin and retains its exact issuer and `/mcp` audience.
- After verifying the new callback configuration and completing or expiring any known
  in-flight old-origin authorization, remove only
  `https://ynab.amesvt.com/callback` from the existing YNAB OAuth application's
  allowlist. Retain `https://ames-ynab.link/callback` and other unrelated
  registered callbacks. Do not change MCP-client redirect registrations.

Retirement must preserve KV, Durable Objects, secrets, credentials, grants,
encrypted journals, and domain renewal settings. Record the final Worker
version, new-domain checks, and absence of the old custom domain/DNS record.

## Acceptance

The final configuration passed all 56 credential-free Worker tests,
Wrangler dry-run, and a semantic comparison confirming that only the old route
and compatibility-origin value changed from the merged cutover configuration.
Identity, storage bindings/migrations, and browser-origin policy are unchanged.
Final deployment is independently confirmed as
`f98c174c-eb6e-4b55-8159-b9ca522adfaa`. Before final configuration deployment,
the new-host review passed 25 GET/OPTIONS checks and 16 policy checks with the
TLS certificate validated using
`curl --resolve`. Public DNS at `1.1.1.1` and the Tailscale resolver returned
`104.21.60.34` and `172.67.191.32`. Local stale negative cache remained in the
Mac's ordinary resolver and Chrome at readback. Public checks used fresh
resolved addresses with certificate
validation; system resolver/network configuration was not changed.
Five final public checks after retirement also passed with valid TLS and
resolved IPs: Googlebot homepage `200`, Python MCP `401` and new metadata
`200`, and the 256px favicon `200`. Session evidence is `final-new-host.json`.
These checks do not claim ordinary system DNS or an authenticated budget read.

The approved AmesVT directory cleanup also completed: website PR #8 merged and
deployed as `b264eb8`, with successful Actions run `38154799390`. The catalog
artifact has 12 remaining entries and no YNAB entry, preserving every other
entry and its order. The live private directory returns its expected `303`
passkey gate; checking its authenticated rendered count requires Oliver's
existing sign-in. No authentication bypass or client configuration change was
performed. Oliver will reconnect his clients at `https://ames-ynab.link/mcp`.

The release 6.0.1 baseline has an authenticated legacy SSE limitation: its exact
`/mcp` audience is rejected by the provider on `/sse` and `/sse/message` before
the handler runs (`401 invalid_token`). The migration retains those routes but
does not claim authenticated SSE acceptance. Track the resource-alias policy
separately; do not widen token origins or audiences to conceal this baseline.

- Run the Worker credential-free suite and Wrangler dry-run. Synthetic fixtures
  must cover both issuers/resources, S256 PKCE, registration and token exchange,
  cross-origin state rejection, wrong-resource/audience rejection, session and
  consent isolation, and existing grants/credentials surviving the new routing.
- Verify HTTPS certificates, direct responses without cross-origin redirects,
  landing/privacy/deletion pages, canonical/Open Graph links, and favicon/PNG/
  Apple touch icon MIME types, dimensions, and cache behavior on both domains.
  Check icons in browser UI as well as their response bytes.
- Fetch both discovery documents. Every authorization-server endpoint must use
  the requested allowed origin; the protected-resource `resource` must equal
  its exact `/mcp` URL and refer to that origin's authorization server. Check
  the unauthenticated MCP `WWW-Authenticate` metadata URL too.
- Confirm unauthenticated `/mcp` returns `401`, an untrusted browser `Origin`
  returns `403`, configured browser origins reach normal authentication, and
  native requests without `Origin` remain supported. Compare automation user
  agents to detect edge blocking before Worker authentication.
- Use an existing authorized old-origin connection for a read-only smoke check
  when available. Verify MCP initialization icons, `ynab_auth_status`, and a
  budget-list read without logging financial data or credentials. Creating a
   new live grant requires an authorized sign-in; report this as deferred if
   that authorization is unavailable. Client configuration is Oliver's own
   follow-up, rather than a service-deployment gate. Do not perform a budget mutation merely
  to validate the domain change.

Retain the unmodified [Works with YNAB integration mark](https://api.ynab.com/papi/works_with_ynab.svg)
and the existing trademark/non-affiliation footer. The tree favicon comes from
[the recorded official YNAB asset](../assets/ynab-tree-blurple.svg); preserve its
source comment and [generator](../scripts/generate-worker-icon-assets.mjs)
checks. Official sourcing does not itself grant unrestricted
branding permission: the [YNAB API Terms](https://api.ynab.com/#terms-of-service)
expressly permit the integration mark and “for YNAB” naming form, restrict
misleading names/artwork/DNS names, and do not expressly permit the standalone
tree as an integration mark. Review the confirmed domain and favicon against
those terms without implying YNAB owns or endorses this connector.

### Favicon and Google Search eligibility

The page explicitly links the stable `/favicon-256x256.png` URL (256×256,
8-bit RGBA, 20,784 bytes). It also links `/favicon.svg` (square 576-unit vector
canvas), a single-frame 32×32 ICO (4,286 bytes), smaller PNGs and the 180×180
Apple touch icon. All use the official tree artwork; the attribution remains.
The deployed Search icon URL is
`https://ames-ynab.link/favicon-256x256.png`.

Google currently requires a square icon at least 8×8 and recommends larger
than 48×48. Its supported formats include PNG and ICO, and omit SVG, so the
explicit 256px PNG provides the Search-compatible option alongside the browser
vector. [Google's favicon requirements](https://developers.google.com/search/docs/appearance/favicon-in-search)

Before cutover, requests with Googlebot and Googlebot-Image user-agent strings
returned 200 for the old homepage and these assets, without challenge or
`noindex` headers. Its `/robots.txt` returned 404, which Google treats as no
crawl restrictions. [Google's robots status handling](https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec#handling-of-errors-and-http-status-codes)
These are public-response checks, not requests from verified Google IPs.
After retirement, the new Googlebot homepage and 256px favicon returned `200`
with valid TLS using resolved IPs. These checks still do not authenticate a
Google crawler's source IP or demonstrate Google indexing.
Eligibility does not guarantee that Google indexes the site or displays its
favicon, and a recrawl can take days or weeks.

## Rollback through cutover

Keep the recorded old code version and routing/OAuth settings available until
cutover is validated. Before any new-origin grants exist, the old Cloudflare
version is a rollback option after checking intervening deployments and keeping the old
route/callback intact. Reverify the old origin afterward. Reverting code does
not restore DNS, zone rules, OAuth application settings, or data automatically.

Once new-origin clients or grants exist, prefer a compatible rollback deployment
that restores `CONNECTOR_BASE_URL=https://ynab.amesvt.com` and lists the new
origin in `CONNECTOR_COMPATIBILITY_ORIGINS`, retaining both provider routes,
custom domains, and YNAB callbacks. Deploying the old single-origin code at that
point can strand the new clients. Never roll back KV/Durable Object contents,
encryption keys, or grant records to fix routing.

Oliver has requested old-domain retirement after verification, so temporary
compatibility is not a promise of ongoing service. If rollback is needed after
retirement, restore the saved old custom-domain/DNS and exact callback settings
with compatible code that supports both origins. Preserve the new-origin
clients as well as old stored credentials. Never restore storage or keys to an
earlier snapshot. A redirect cannot migrate an OAuth grant or its audience.
