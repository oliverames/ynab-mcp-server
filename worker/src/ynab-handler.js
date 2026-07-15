// Default (non-API) handler for the OAuthProvider: landing, consent,
// the upstream YNAB OAuth dance, privacy, and data deletion.
// Consent and upstream state use high-entropy, one-time server-side records
// with 10-minute TTLs and keyed hashes. They do not depend on browser cookies,
// because embedded OAuth browsers do not reliably preserve them.

import { Hono } from "hono";
import {
  buildYnabAuthorizeUrl,
  exchangeCodeForTokens,
  fetchYnabUserId,
  saveTokenRecord,
  tokenRecordKey,
  undoJournalKey,
  randomToken,
  sha256base64url,
  hmacSign,
  hmacVerify,
} from "./ynab-oauth.js";
import {
  WORKS_WITH_YNAB_PNG,
  WORKS_WITH_YNAB_PNG_SHA256,
  WORKS_WITH_YNAB_SVG,
  WORKS_WITH_YNAB_SVG_SHA256,
} from "./brand-assets.js";
import { landingPage, consentPage, privacyPage, deletePage, deletedPage, errorPage } from "./pages.js";

const STATE_TTL_SECONDS = 600;
const CSRF_COOKIE = "__Host-ynab_mcp_csrf";
const CONSENT_PREFIX = "oauth_consent:";
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

const app = new Hono();

function html(c, body, status = 200) {
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  return c.html(body, status);
}

function worksWithYnabAsset(c, { body, contentType, sha256 }) {
  const etag = `"sha256-${sha256}"`;
  c.header("Content-Type", contentType);
  c.header("Cache-Control", "public, max-age=31536000, immutable");
  c.header("Content-Security-Policy", "default-src 'none'; sandbox");
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("ETag", etag);
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
  return c.body(body);
}

function setCookie(c, name, value) {
  c.header("Set-Cookie", `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}`, { append: true });
}

function clearCookie(c, name) {
  c.header("Set-Cookie", `${name}=; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=0`, { append: true });
}

function readCookie(c, name) {
  const header = c.req.header("Cookie") || "";
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function callbackUri(c) {
  const baseUrl = c.env.CONNECTOR_BASE_URL;
  if (!baseUrl) throw new Error("CONNECTOR_BASE_URL is required");
  const base = new URL(baseUrl);
  const isLocal = base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if (base.protocol !== "https:" && !isLocal) {
    throw new Error("CONNECTOR_BASE_URL must use HTTPS (except localhost development)");
  }
  return new URL("/callback", base).href;
}

async function issueCsrf(c, cookieName = CSRF_COOKIE) {
  const csrfToken = randomToken(16);
  setCookie(c, cookieName, await hmacSign(c.env.COOKIE_ENCRYPTION_KEY, csrfToken));
  return csrfToken;
}

async function validateCsrf(c, form, cookieName = CSRF_COOKIE) {
  const csrfCookie = readCookie(c, cookieName);
  if (!form.csrf || !csrfCookie) return false;
  const valid = csrfCookie === await hmacSign(c.env.COOKIE_ENCRYPTION_KEY, String(form.csrf));
  if (valid) clearCookie(c, cookieName);
  return valid;
}

app.get("/", (c) => html(c, landingPage()));
app.get("/assets/works-with-ynab.png", (c) => worksWithYnabAsset(c, {
  body: WORKS_WITH_YNAB_PNG,
  contentType: "image/png",
  sha256: WORKS_WITH_YNAB_PNG_SHA256,
}));
app.get("/assets/works-with-ynab.svg", (c) => worksWithYnabAsset(c, {
  body: WORKS_WITH_YNAB_SVG,
  contentType: "image/svg+xml; charset=utf-8",
  sha256: WORKS_WITH_YNAB_SVG_SHA256,
}));
app.get("/favicon.ico", (c) => worksWithYnabAsset(c, {
  body: WORKS_WITH_YNAB_PNG,
  contentType: "image/png",
  sha256: WORKS_WITH_YNAB_PNG_SHA256,
}));
app.get("/favicon.png", (c) => worksWithYnabAsset(c, {
  body: WORKS_WITH_YNAB_PNG,
  contentType: "image/png",
  sha256: WORKS_WITH_YNAB_PNG_SHA256,
}));
app.get("/favicon.svg", (c) => worksWithYnabAsset(c, {
  body: WORKS_WITH_YNAB_SVG,
  contentType: "image/svg+xml; charset=utf-8",
  sha256: WORKS_WITH_YNAB_SVG_SHA256,
}));
app.get("/privacy", (c) => html(c, privacyPage()));
app.get("/delete", async (c) => html(c, deletePage({ csrfToken: await issueCsrf(c) })));

// --- MCP-client-facing consent ---

app.get("/authorize", async (c) => {
  let oauthReqInfo;
  try {
    oauthReqInfo = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch (e) {
    return html(c, errorPage("Invalid authorization request."), 400);
  }
  if (!oauthReqInfo?.clientId) return html(c, errorPage("Missing OAuth client id."), 400);
  const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
  const consentId = randomToken(24);
  const csrfToken = randomToken(24);
  const csrfHash = await hmacSign(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-consent:${consentId}:${csrfToken}`
  );
  await c.env.OAUTH_KV.put(`${CONSENT_PREFIX}${consentId}`, JSON.stringify({ oauthReqInfo, csrfHash }), {
    expirationTtl: STATE_TTL_SECONDS,
  });
  return html(c, consentPage({
    clientName: client?.clientName || oauthReqInfo.clientId,
    redirectUri: oauthReqInfo.redirectUri || (client?.redirectUris?.[0] ?? "unknown"),
    consentId,
    csrfToken,
  }));
});

app.post("/authorize", async (c) => {
  const form = await c.req.parseBody();
  const consentId = String(form.consent || "");
  if (!consentId) return html(c, errorPage("Missing authorization request."), 400);
  if (!OPAQUE_ID_PATTERN.test(consentId)) return html(c, errorPage("Consent form expired or invalid. Start again from your MCP client."), 400);
  const consentKey = `${CONSENT_PREFIX}${consentId}`;
  const rawRequest = await c.env.OAUTH_KV.get(consentKey);
  await c.env.OAUTH_KV.delete(consentKey); // one-time consent payload
  if (!rawRequest) return html(c, errorPage("Authorization request expired. Start again from your MCP client."), 400);
  let storedConsent;
  try {
    storedConsent = JSON.parse(rawRequest);
  } catch {
    return html(c, errorPage("Stored authorization request was invalid."), 500);
  }
  const csrfValid = await hmacVerify(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-consent:${consentId}:${String(form.csrf || "")}`,
    storedConsent?.csrfHash
  );
  if (!csrfValid) {
    return html(c, errorPage("Consent form expired or invalid. Start again from your MCP client."), 400);
  }
  const oauthReqInfo = storedConsent?.oauthReqInfo;
  if (!oauthReqInfo?.clientId || !oauthReqInfo?.redirectUri) {
    return html(c, errorPage("Stored authorization request was incomplete."), 400);
  }
  return startYnabDance(c, {
    purpose: "authorize",
    oauthReqInfo,
    writesEnabled: form.writes === "1",
    // Read-only YNAB scope unless the user opted into writes.
    readOnly: form.writes !== "1",
  });
});

// Deletion proves ownership with a read-only YNAB sign-in, then purges.
app.post("/delete", async (c) => {
  const form = await c.req.parseBody();
  if (!await validateCsrf(c, form)) {
    return html(c, errorPage("Deletion form expired or invalid. Open the deletion page and try again."), 400);
  }
  return startYnabDance(c, { purpose: "delete", readOnly: true });
});

async function startYnabDance(c, stateRecord) {
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = await sha256base64url(codeVerifier);
  const stateHash = await hmacSign(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-state:${state}`
  );
  await c.env.OAUTH_KV.put(
    `oauth_state:${state}`,
    JSON.stringify({ ...stateRecord, codeVerifier, stateHash }),
    { expirationTtl: STATE_TTL_SECONDS }
  );
  const redirectUri = callbackUri(c);
  return c.redirect(buildYnabAuthorizeUrl({
    clientId: c.env.YNAB_CLIENT_ID,
    redirectUri,
    state,
    codeChallenge,
    readOnly: stateRecord.readOnly,
  }));
}

// --- YNAB redirects back here ---

app.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const upstreamError = c.req.query("error");
  if ((!code && !upstreamError) || !state) return html(c, errorPage("Missing authorization result or state from YNAB."), 400);
  if (!OPAQUE_ID_PATTERN.test(state)) {
    return html(c, errorPage("Authorization state expired or did not match. Start again from your MCP client."), 400);
  }

  const stateKey = `oauth_state:${state}`;
  const rawRecord = await c.env.OAUTH_KV.get(stateKey);
  await c.env.OAUTH_KV.delete(stateKey); // single use
  if (!rawRecord) {
    return html(c, errorPage("Authorization state expired or did not match. Start again from your MCP client."), 400);
  }

  let record;
  try {
    record = JSON.parse(rawRecord);
  } catch {
    return html(c, errorPage("Stored authorization state was invalid. Start again from your MCP client."), 500);
  }
  const stateValid = await hmacVerify(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-state:${state}`,
    record?.stateHash
  );
  if (!stateValid) {
    return html(c, errorPage("Authorization state expired or did not match. Start again from your MCP client."), 400);
  }
  if (upstreamError) {
    return html(c, errorPage("YNAB did not authorize the connector. No connector grant was created."), 400);
  }
  const redirectUri = callbackUri(c);

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(c.env, { code, redirectUri, codeVerifier: record.codeVerifier });
  } catch (e) {
    return html(c, errorPage(`Could not exchange the YNAB authorization code (${e.message}).`), 502);
  }

  let ynabUserId;
  try {
    ynabUserId = await fetchYnabUserId(tokens.accessToken);
  } catch (e) {
    return html(c, errorPage(`Authorized with YNAB but could not read the user profile (${e.message}).`), 502);
  }

  if (record.purpose === "delete") {
    try {
      await revokeAllUserGrants(c.env.OAUTH_PROVIDER, ynabUserId);
    } catch (e) {
      return html(c, errorPage("Could not revoke every connector grant. No success confirmation was issued; please retry deletion."), 502);
    }
    await c.env.OAUTH_KV.delete(tokenRecordKey(ynabUserId));
    await c.env.OAUTH_KV.delete(undoJournalKey(ynabUserId));
    return html(c, deletedPage());
  }

  try {
    const { redirectTo } = await persistTokensAndAuthorize(c.env, {
      record,
      tokens,
      ynabUserId,
    });
    return c.redirect(redirectTo);
  } catch {
    return html(c, errorPage("Could not complete the connector authorization. Start again from your MCP client."), 502);
  }
});

export async function persistTokensAndAuthorize(env, { record, tokens, ynabUserId }) {
  const key = tokenRecordKey(ynabUserId);
  const previousRecord = await env.OAUTH_KV.get(key);
  const writtenRecord = await saveTokenRecord(
    env.OAUTH_KV,
    ynabUserId,
    tokens,
    env.DATA_ENCRYPTION_KEY
  );

  try {
    return await env.OAUTH_PROVIDER.completeAuthorization({
      request: record.oauthReqInfo,
      userId: ynabUserId,
      metadata: { authorizedAt: new Date().toISOString() },
      scope: record.writesEnabled ? ["read", "write"] : ["read"],
      // Props are encrypted into the grant and surface as this.props in the
      // MCP agent. Tokens themselves live in the KV record (they rotate);
      // props carry only identity and the write choice.
      props: { ynabUserId, writesEnabled: !!record.writesEnabled },
    });
  } catch (error) {
    // Roll back only if this callback still owns the current value. A second
    // callback may have completed for the same user while this one was in
    // flight, and KV does not provide compare-and-swap.
    if (await env.OAUTH_KV.get(key) === writtenRecord) {
      if (previousRecord === null) await env.OAUTH_KV.delete(key);
      else await env.OAUTH_KV.put(key, previousRecord);
    }
    throw error;
  }
}

export async function revokeAllUserGrants(oauthProvider, userId) {
  let cursor;
  do {
    const page = await oauthProvider.listUserGrants(userId, { cursor, limit: 100 });
    for (const grant of page?.items ?? []) {
      await oauthProvider.revokeGrant(grant.id, userId);
    }
    cursor = page?.cursor;
  } while (cursor);
}

export { app as YnabHandler };
