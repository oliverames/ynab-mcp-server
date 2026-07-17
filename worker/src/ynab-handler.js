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
  encryptStoredJson,
  decryptStoredJson,
} from "./ynab-oauth.js";
import { putTransientState, consumeTransientState } from "./transient-state.js";
import {
  CONNECTOR_APPLE_TOUCH_ICON_PNG,
  CONNECTOR_APPLE_TOUCH_ICON_PNG_SHA256,
  CONNECTOR_FAVICON_16_PNG,
  CONNECTOR_FAVICON_16_PNG_SHA256,
  CONNECTOR_FAVICON_32_PNG,
  CONNECTOR_FAVICON_32_PNG_SHA256,
  CONNECTOR_FAVICON_ICO,
  CONNECTOR_FAVICON_ICO_SHA256,
  CONNECTOR_ICON_PNG,
  CONNECTOR_ICON_PNG_SHA256,
  WORKS_WITH_YNAB_PNG,
  WORKS_WITH_YNAB_PNG_SHA256,
  WORKS_WITH_YNAB_SVG,
  WORKS_WITH_YNAB_SVG_SHA256,
} from "./brand-assets.js";
import { landingPage, consentPage, finalConsentPage, privacyPage, deletePage, deletedPage, errorPage } from "./pages.js";

const STATE_TTL_SECONDS = 600;
const CSRF_COOKIE = "__Host-ynab_mcp_csrf";
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{32}$/;

const app = new Hono();

function formActionSources(urls) {
  const sources = new Set(["'self'"]);
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") {
        sources.add(url.origin);
      }
    } catch {
      // Non-URL labels, such as the deletion flow description, stay self-only.
    }
  }
  return [...sources].join(" ");
}

function html(c, body, status = 200, { formActionUrls = [] } = {}) {
  c.header("Cache-Control", "no-store");
  c.header("Content-Security-Policy", `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action ${formActionSources(formActionUrls)}; frame-ancestors 'none'; base-uri 'none'`);
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Referrer-Policy", "same-origin");
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

function canonicalOrigin(c) {
  return new URL(c.env.CONNECTOR_BASE_URL).origin;
}

function isSameOriginPost(c) {
  const expectedOrigin = canonicalOrigin(c);
  const origin = c.req.header("Origin");

  // Browsers normally send Origin on form POSTs. If one is present, it is
  // authoritative: never let other request metadata override a mismatch or
  // an opaque `Origin: null` value.
  if (origin !== undefined) return origin === expectedOrigin;

  // Some embedded OAuth browsers omit Origin for a same-origin document
  // navigation. Fetch Metadata headers are browser-controlled (page scripts
  // cannot set them), and the same-origin referrer is emitted because these
  // HTML responses use Referrer-Policy: same-origin.
  if (c.req.header("Sec-Fetch-Site") !== "same-origin") return false;
  if (c.req.header("Sec-Fetch-Mode") !== "navigate") return false;
  if (c.req.header("Sec-Fetch-Dest") !== "document") return false;

  const referer = c.req.header("Referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === expectedOrigin;
  } catch {
    return false;
  }
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
app.get("/assets/icon.png", (c) => worksWithYnabAsset(c, {
  body: CONNECTOR_ICON_PNG,
  contentType: "image/png",
  sha256: CONNECTOR_ICON_PNG_SHA256,
}));
// Keep the former path as an exact alias so existing host records do not break.
app.get("/assets/ynab-app-icon.png", (c) => worksWithYnabAsset(c, {
  body: CONNECTOR_ICON_PNG,
  contentType: "image/png",
  sha256: CONNECTOR_ICON_PNG_SHA256,
}));
app.get("/favicon.ico", (c) => worksWithYnabAsset(c, {
  body: CONNECTOR_FAVICON_ICO,
  contentType: "image/x-icon",
  sha256: CONNECTOR_FAVICON_ICO_SHA256,
}));
app.get("/favicon-16x16.png", (c) => worksWithYnabAsset(c, {
  body: CONNECTOR_FAVICON_16_PNG,
  contentType: "image/png",
  sha256: CONNECTOR_FAVICON_16_PNG_SHA256,
}));
app.get("/favicon-32x32.png", (c) => worksWithYnabAsset(c, {
  body: CONNECTOR_FAVICON_32_PNG,
  contentType: "image/png",
  sha256: CONNECTOR_FAVICON_32_PNG_SHA256,
}));
app.get("/favicon.png", (c) => worksWithYnabAsset(c, {
  body: CONNECTOR_FAVICON_32_PNG,
  contentType: "image/png",
  sha256: CONNECTOR_FAVICON_32_PNG_SHA256,
}));
app.get("/apple-touch-icon.png", (c) => worksWithYnabAsset(c, {
  body: CONNECTOR_APPLE_TOUCH_ICON_PNG,
  contentType: "image/png",
  sha256: CONNECTOR_APPLE_TOUCH_ICON_PNG_SHA256,
}));
app.get("/privacy", (c) => html(c, privacyPage()));
app.get("/delete", async (c) => html(
  c,
  deletePage({ csrfToken: await issueCsrf(c) }),
  200,
  { formActionUrls: ["https://app.ynab.com"] }
));

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
  const clientName = client?.clientName || oauthReqInfo.clientId;
  const redirectUri = oauthReqInfo.redirectUri || (client?.redirectUris?.[0] ?? "unknown");
  const consentId = randomToken(24);
  const csrfToken = randomToken(24);
  const csrfHash = await hmacSign(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-consent:${consentId}:${csrfToken}`
  );
  await putTransientState(c.env, `consent:${consentId}`, {
    oauthReqInfo,
    csrfHash,
    clientName,
    redirectUri,
  }, STATE_TTL_SECONDS);
  return html(
    c,
    consentPage({
      clientName,
      redirectUri,
      consentId,
      csrfToken,
    }),
    200,
    { formActionUrls: ["https://app.ynab.com"] }
  );
});

app.post("/authorize", async (c) => {
  if (!isSameOriginPost(c)) {
    return html(c, errorPage("Authorization forms must be submitted from the same connector origin."), 403);
  }
  const form = await c.req.parseBody();
  const consentId = String(form.consent || "");
  if (!consentId) return html(c, errorPage("Missing authorization request."), 400);
  if (!OPAQUE_ID_PATTERN.test(consentId)) return html(c, errorPage("Consent form expired or invalid. Start again from your MCP client."), 400);
  const storedConsent = await consumeTransientState(c.env, `consent:${consentId}`);
  if (!storedConsent) return html(c, errorPage("Authorization request expired. Start again from your MCP client."), 400);
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
    clientName: storedConsent.clientName,
    redirectUri: storedConsent.redirectUri,
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
  return startYnabDance(c, {
    purpose: "delete",
    clientName: "YNAB",
    redirectUri: "connector data deletion",
    readOnly: true,
  });
});

async function startYnabDance(c, stateRecord) {
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = await sha256base64url(codeVerifier);
  const stateHash = await hmacSign(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-state:${state}`
  );
  await putTransientState(c.env, `state:${state}`, {
    ...stateRecord,
    codeVerifier,
    stateHash,
  }, STATE_TTL_SECONDS);
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

  const record = await consumeTransientState(c.env, `state:${state}`);
  if (!record) {
    return html(c, errorPage("Authorization state expired or did not match. Start again from your MCP client."), 400);
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

  const finalId = randomToken(24);
  const csrfToken = randomToken(24);
  const csrfHash = await hmacSign(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-final:${finalId}:${csrfToken}`
  );
  const encryptedAuthorization = await encryptStoredJson(
    c.env.DATA_ENCRYPTION_KEY,
    `oauth_final:${finalId}`,
    { record, tokens, ynabUserId }
  );
  await putTransientState(c.env, `final:${finalId}`, {
    csrfHash,
    encryptedAuthorization,
  }, STATE_TTL_SECONDS);
  return html(
    c,
    finalConsentPage({
      clientName: record.clientName,
      redirectUri: record.redirectUri,
      writesEnabled: !!record.writesEnabled,
      purpose: record.purpose,
      finalId,
      csrfToken,
    }),
    200,
    { formActionUrls: [record.redirectUri] }
  );
});

app.post("/callback", async (c) => {
  if (!isSameOriginPost(c)) {
    return html(c, errorPage("Final confirmation must be submitted from the same connector origin."), 403);
  }
  const form = await c.req.parseBody();
  const finalId = String(form.finalize || "");
  if (!OPAQUE_ID_PATTERN.test(finalId)) {
    return html(c, errorPage("Final confirmation expired or invalid. Start again from your MCP client."), 400);
  }
  const pending = await consumeTransientState(c.env, `final:${finalId}`);
  if (!pending) {
    return html(c, errorPage("Final confirmation expired or invalid. Start again from your MCP client."), 400);
  }
  const csrfValid = await hmacVerify(
    c.env.COOKIE_ENCRYPTION_KEY,
    `oauth-final:${finalId}:${String(form.csrf || "")}`,
    pending.csrfHash
  );
  if (!csrfValid) {
    return html(c, errorPage("Final confirmation expired or invalid. Start again from your MCP client."), 400);
  }

  let authorization;
  try {
    const decrypted = await decryptStoredJson(
      c.env.DATA_ENCRYPTION_KEY,
      `oauth_final:${finalId}`,
      pending.encryptedAuthorization
    );
    authorization = decrypted.value;
  } catch {
    return html(c, errorPage("Stored final authorization was invalid. Start again from your MCP client."), 500);
  }
  const { record, tokens, ynabUserId } = authorization ?? {};
  if (!record || !tokens?.accessToken || !ynabUserId) {
    return html(c, errorPage("Stored final authorization was incomplete. Start again from your MCP client."), 500);
  }

  if (record.purpose === "delete") {
    try {
      await revokeAllUserGrants(c.env.OAUTH_PROVIDER, ynabUserId);
    } catch {
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
