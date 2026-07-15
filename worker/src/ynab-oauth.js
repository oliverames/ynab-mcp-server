// Upstream YNAB OAuth helpers: authorize-URL construction, code exchange,
// refresh, and the KV-backed per-user token record. YNAB specifics
// (api.ynab.com/#oauth-applications): access tokens live 2 hours, refresh
// tokens are issued with the authorization-code grant and rotate on use,
// the only scope is "read-only" (omitting scope grants full read/write).

const YNAB_AUTHORIZE_URL = "https://app.ynab.com/oauth/authorize";
const YNAB_TOKEN_URL = "https://app.ynab.com/oauth/token";
const YNAB_API_BASE = "https://api.ynab.com/v1";

// Refresh when within this window of expiry (docs/hosted-oauth-connector.md).
const REFRESH_SAFETY_WINDOW_MS = 60000;

export function tokenRecordKey(ynabUserId) {
  return `ynab_token:${ynabUserId}`;
}

export function undoJournalKey(ynabUserId) {
  return `ynab_undo:${ynabUserId}`;
}

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function base64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256base64url(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}

export async function hmacSign(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return base64url(new Uint8Array(sig));
}

export function buildYnabAuthorizeUrl({ clientId, redirectUri, state, codeChallenge, readOnly }) {
  const url = new URL(YNAB_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  // Omitting scope grants full read/write; "read-only" restricts writes (YNAB has no other scopes).
  if (readOnly) url.searchParams.set("scope", "read-only");
  return url.toString();
}

async function ynabTokenRequest(env, params) {
  const body = new URLSearchParams({
    client_id: env.YNAB_CLIENT_ID,
    client_secret: env.YNAB_CLIENT_SECRET,
    ...params,
  });
  const res = await fetch(YNAB_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    // Never surface response bodies here: they can echo request parameters.
    throw new Error(`YNAB token endpoint returned HTTP ${res.status}`);
  }
  const json = await res.json();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    // expires_in is seconds; store an absolute cutoff for the refresh check.
    expiresAt: Date.now() + (Number(json.expires_in) || 7200) * 1000,
  };
}

export function exchangeCodeForTokens(env, { code, redirectUri, codeVerifier }) {
  return ynabTokenRequest(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
}

export function refreshTokens(env, refreshToken) {
  return ynabTokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken });
}

export async function fetchYnabUserId(accessToken) {
  const res = await fetch(`${YNAB_API_BASE}/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`YNAB /user returned HTTP ${res.status}`);
  const json = await res.json();
  return json?.data?.user?.id;
}

export async function saveTokenRecord(kv, ynabUserId, record) {
  await kv.put(tokenRecordKey(ynabUserId), JSON.stringify(record));
}

export async function readTokenRecord(kv, ynabUserId) {
  const raw = await kv.get(tokenRecordKey(ynabUserId));
  return raw ? JSON.parse(raw) : null;
}

// Return a currently-valid access token for the user, refreshing (and
// persisting the rotated refresh token) when inside the safety window.
// Returns null when no usable token exists — the shared tool layer then
// answers with its structured missing-credentials result instead of crashing.
export async function getFreshAccessToken(env, ynabUserId) {
  const record = await readTokenRecord(env.OAUTH_KV, ynabUserId);
  if (!record?.accessToken) return null;
  if (Date.now() < record.expiresAt - REFRESH_SAFETY_WINDOW_MS) {
    return record.accessToken;
  }
  if (!record.refreshToken) return null;
  try {
    const refreshed = await refreshTokens(env, record.refreshToken);
    await saveTokenRecord(env.OAUTH_KV, ynabUserId, refreshed);
    return refreshed.accessToken;
  } catch {
    // Stale or already-rotated refresh token: require reauthorization
    // rather than looping on a dead credential (doc: token lifecycle).
    await env.OAUTH_KV.delete(tokenRecordKey(ynabUserId));
    return null;
  }
}

// KV-backed undo journal implementing the shared layer's async journal
// interface ({ read, persist }); one record per YNAB user.
export function createKvJournal(kv, ynabUserId) {
  const key = undoJournalKey(ynabUserId);
  return {
    async read() {
      const raw = await kv.get(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    },
    async persist(entries) {
      await kv.put(key, JSON.stringify(entries));
    },
  };
}
