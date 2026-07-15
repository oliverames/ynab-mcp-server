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

function base64urlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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

export async function hmacVerify(secret, text, signature) {
  if (!secret || typeof signature !== "string" || !signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    return crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(signature),
      new TextEncoder().encode(text)
    );
  } catch {
    return false;
  }
}

async function dataEncryptionKey(secret) {
  if (!secret) throw new Error("DATA_ENCRYPTION_KEY is required");
  const keyMaterial = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ynab-mcp-data-v1:${secret}`)
  );
  return crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptStoredJson(secret, storageKey, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv,
    additionalData: new TextEncoder().encode(storageKey),
  }, await dataEncryptionKey(secret), plaintext);
  return JSON.stringify({
    v: 1,
    iv: base64url(iv),
    ciphertext: base64url(new Uint8Array(ciphertext)),
  });
}

export async function decryptStoredJson(secret, storageKey, raw) {
  const parsed = JSON.parse(raw);
  // One-time migration for values written by the initial deployment before
  // application-layer encryption was added. The next read rewrites them.
  if (parsed?.v !== 1 || !parsed.iv || !parsed.ciphertext) {
    return { value: parsed, legacy: true };
  }
  const plaintext = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv: base64urlDecode(parsed.iv),
    additionalData: new TextEncoder().encode(storageKey),
  }, await dataEncryptionKey(secret), base64urlDecode(parsed.ciphertext));
  return { value: JSON.parse(new TextDecoder().decode(plaintext)), legacy: false };
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
    redirect: "error",
  });
  if (!res.ok) {
    // Never surface response bodies here: they can echo request parameters.
    throw new Error(`YNAB token endpoint returned HTTP ${res.status}`);
  }
  const json = await res.json();
  if (typeof json.access_token !== "string" || !json.access_token) {
    throw new Error("YNAB token endpoint response was missing an access token");
  }
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
  return ynabTokenRequest(env, { grant_type: "refresh_token", refresh_token: refreshToken })
    .then((record) => ({
      ...record,
      // OAuth permits a refresh response to omit a replacement token. Keep
      // the current one unless YNAB explicitly rotates it.
      refreshToken: record.refreshToken || refreshToken,
    }));
}

export async function fetchYnabUserId(accessToken) {
  const res = await fetch(`${YNAB_API_BASE}/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "error",
  });
  if (!res.ok) throw new Error(`YNAB /user returned HTTP ${res.status}`);
  const json = await res.json();
  const userId = json?.data?.user?.id;
  if (typeof userId !== "string" || !userId) {
    throw new Error("YNAB /user response was missing a user id");
  }
  return userId;
}

export async function saveTokenRecord(kv, ynabUserId, record, encryptionSecret) {
  const key = tokenRecordKey(ynabUserId);
  const encryptedRecord = await encryptStoredJson(encryptionSecret, key, record);
  await kv.put(key, encryptedRecord);
  return encryptedRecord;
}

export async function readTokenRecord(kv, ynabUserId, encryptionSecret) {
  const key = tokenRecordKey(ynabUserId);
  const raw = await kv.get(key);
  if (!raw) return null;
  const decoded = await decryptStoredJson(encryptionSecret, key, raw);
  if (decoded.legacy) await saveTokenRecord(kv, ynabUserId, decoded.value, encryptionSecret);
  return decoded.value;
}

// Return a currently-valid access token for the user, refreshing (and
// persisting the rotated refresh token) when inside the safety window.
// Returns null when no usable token exists — the shared tool layer then
// answers with its structured missing-credentials result instead of crashing.
export async function getFreshAccessToken(env, ynabUserId) {
  const record = await readTokenRecord(env.OAUTH_KV, ynabUserId, env.DATA_ENCRYPTION_KEY);
  if (!record?.accessToken) return null;
  if (Date.now() < record.expiresAt - REFRESH_SAFETY_WINDOW_MS) {
    return record.accessToken;
  }
  if (!record.refreshToken) return null;
  try {
    const refreshed = await refreshTokens(env, record.refreshToken);
    await saveTokenRecord(env.OAUTH_KV, ynabUserId, refreshed, env.DATA_ENCRYPTION_KEY);
    return refreshed.accessToken;
  } catch {
    // Another MCP session may have refreshed the same rotating token first.
    // Re-read before failing; never delete here because KV has no atomic
    // compare-and-delete and doing so could erase the peer's fresh record.
    const latest = await readTokenRecord(env.OAUTH_KV, ynabUserId, env.DATA_ENCRYPTION_KEY);
    if (latest?.accessToken && (
      latest.refreshToken !== record.refreshToken || latest.expiresAt > record.expiresAt
    )) {
      return latest.accessToken;
    }
    return null;
  }
}

// KV-backed undo journal implementing the shared layer's async journal
// interface ({ read, persist }); one record per YNAB user.
export function createKvJournal(env, ynabUserId) {
  const key = undoJournalKey(ynabUserId);
  return {
    async read() {
      const raw = await env.OAUTH_KV.get(key);
      if (!raw) return [];
      const decoded = await decryptStoredJson(env.DATA_ENCRYPTION_KEY, key, raw);
      const entries = Array.isArray(decoded.value) ? decoded.value : [];
      if (decoded.legacy) await env.OAUTH_KV.put(
        key,
        await encryptStoredJson(env.DATA_ENCRYPTION_KEY, key, entries)
      );
      return entries;
    },
    async persist(entries) {
      await env.OAUTH_KV.put(
        key,
        await encryptStoredJson(env.DATA_ENCRYPTION_KEY, key, entries)
      );
    },
  };
}
