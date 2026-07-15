// Default (non-API) handler for the OAuthProvider: landing, consent,
// the upstream YNAB OAuth dance, privacy, and data deletion.
// State handling follows docs/hosted-oauth-connector.md: server-side state
// record with 10-minute TTL bound to an HttpOnly cookie carrying a keyed
// hash of the state, deleted after first use.

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
} from "./ynab-oauth.js";
import { landingPage, consentPage, privacyPage, deletePage, deletedPage, errorPage } from "./pages.js";

const STATE_TTL_SECONDS = 600;
const STATE_COOKIE = "__Host-ynab_mcp_state";
const CSRF_COOKIE = "__Host-ynab_mcp_csrf";

const app = new Hono();

function html(c, body, status = 200) {
  return c.html(body, status);
}

function setCookie(c, name, value) {
  c.header("Set-Cookie", `${name}=${value}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}`, { append: true });
}

function readCookie(c, name) {
  const header = c.req.header("Cookie") || "";
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : null;
}

function b64urlEncodeJson(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeJson(value) {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(b64));
}

app.get("/", (c) => html(c, landingPage()));
app.get("/privacy", (c) => html(c, privacyPage()));
app.get("/delete", (c) => html(c, deletePage()));

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
  const csrfToken = randomToken(16);
  setCookie(c, CSRF_COOKIE, await hmacSign(c.env.COOKIE_ENCRYPTION_KEY, csrfToken));
  return html(c, consentPage({
    clientName: client?.clientName || oauthReqInfo.clientId,
    redirectUri: oauthReqInfo.redirectUri || (client?.redirectUris?.[0] ?? "unknown"),
    encodedReqInfo: b64urlEncodeJson(oauthReqInfo),
    csrfToken,
  }));
});

app.post("/authorize", async (c) => {
  const form = await c.req.parseBody();
  const csrfCookie = readCookie(c, CSRF_COOKIE);
  if (!form.csrf || !csrfCookie || csrfCookie !== await hmacSign(c.env.COOKIE_ENCRYPTION_KEY, String(form.csrf))) {
    return html(c, errorPage("Consent form expired or invalid. Start again from your MCP client."), 400);
  }
  let oauthReqInfo;
  try {
    oauthReqInfo = b64urlDecodeJson(String(form.req));
  } catch {
    return html(c, errorPage("Malformed authorization payload."), 400);
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
app.post("/delete", (c) => startYnabDance(c, { purpose: "delete", readOnly: true }));

async function startYnabDance(c, stateRecord) {
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = await sha256base64url(codeVerifier);
  await c.env.OAUTH_KV.put(
    `oauth_state:${state}`,
    JSON.stringify({ ...stateRecord, codeVerifier }),
    { expirationTtl: STATE_TTL_SECONDS }
  );
  setCookie(c, STATE_COOKIE, await hmacSign(c.env.COOKIE_ENCRYPTION_KEY, state));
  const redirectUri = `${new URL(c.req.url).origin}/callback`;
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
  if (!code || !state) return html(c, errorPage("Missing code or state from YNAB."), 400);

  const stateKey = `oauth_state:${state}`;
  const rawRecord = await c.env.OAUTH_KV.get(stateKey);
  const cookieHash = readCookie(c, STATE_COOKIE);
  const expectedHash = await hmacSign(c.env.COOKIE_ENCRYPTION_KEY, state);
  if (!rawRecord || !cookieHash || cookieHash !== expectedHash) {
    return html(c, errorPage("Authorization state expired or did not match. Start again from your MCP client."), 400);
  }
  await c.env.OAUTH_KV.delete(stateKey); // single use

  const record = JSON.parse(rawRecord);
  const redirectUri = `${new URL(c.req.url).origin}/callback`;

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
    await c.env.OAUTH_KV.delete(tokenRecordKey(ynabUserId));
    await c.env.OAUTH_KV.delete(undoJournalKey(ynabUserId));
    // Revoke this connector's own grants for the user as well.
    try {
      const grants = await c.env.OAUTH_PROVIDER.listUserGrants(ynabUserId);
      for (const grant of grants?.items ?? []) {
        await c.env.OAUTH_PROVIDER.revokeGrant(grant.id, ynabUserId);
      }
    } catch {
      // Grant listing is best-effort; token + journal deletion above is the
      // hard requirement, and YNAB-side revocation is in the page copy.
    }
    return html(c, deletedPage());
  }

  await saveTokenRecord(c.env.OAUTH_KV, ynabUserId, tokens);

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: record.oauthReqInfo,
    userId: ynabUserId,
    metadata: { authorizedAt: new Date().toISOString() },
    scope: record.writesEnabled ? ["read", "write"] : ["read"],
    // Props are encrypted into the grant and surface as this.props in the
    // MCP agent. Tokens themselves live in the KV record (they rotate);
    // props carry only identity and the write choice.
    props: { ynabUserId, writesEnabled: !!record.writesEnabled },
  });
  return c.redirect(redirectTo);
});

export { app as YnabHandler };
