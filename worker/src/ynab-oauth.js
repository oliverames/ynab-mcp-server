// Upstream YNAB OAuth helpers: authorize-URL construction, code exchange,
// refresh, and encrypted per-consent token records. YNAB specifics
// (api.ynab.com/#oauth-applications): access tokens live 2 hours, refresh
// tokens are issued with the authorization-code grant and rotate on use,
// the only scope is "read-only" (omitting scope grants full read/write).

const YNAB_AUTHORIZE_URL = "https://app.ynab.com/oauth/authorize";
const YNAB_TOKEN_URL = "https://app.ynab.com/oauth/token";
const YNAB_API_BASE = "https://api.ynab.com/v1";

// Refresh when within this window of expiry (docs/hosted-oauth-connector.md).
const REFRESH_SAFETY_WINDOW_MS = 60000;

function assertNoUpstreamRedirect(response, endpointName) {
  if (
    response.redirected
    || response.type === "opaqueredirect"
    || (response.status >= 300 && response.status < 400)
  ) {
    throw new Error(`${endpointName} returned an unexpected redirect`);
  }
}

export function isCredentialBinding(binding) {
  return binding?.credentialVersion === 2
    && typeof binding.ynabUserId === "string" && !!binding.ynabUserId
    && typeof binding.clientId === "string" && !!binding.clientId
    && typeof binding.credentialId === "string" && /^[A-Za-z0-9_-]{32}$/.test(binding.credentialId)
    && typeof binding.writesEnabled === "boolean";
}

export function credentialIdentity(binding) {
  if (!isCredentialBinding(binding)) throw new Error("Reconnect the YNAB connector to authorize an isolated credential.");
  return `${encodeURIComponent(binding.ynabUserId)}:${binding.credentialId}`;
}

export function tokenRecordKey(binding) {
  // String keys exist only for deleting the ambiguous pre-v2 records.
  return typeof binding === "string" ? `ynab_token:${binding}` : `ynab_token:v2:${credentialIdentity(binding)}`;
}

export function undoJournalKey(binding) {
  return typeof binding === "string" ? `ynab_undo:${binding}` : `ynab_undo:v2:${credentialIdentity(binding)}`;
}

export function credentialBindingsMatch(a, b) {
  return isCredentialBinding(a) && isCredentialBinding(b)
    && ["credentialVersion", "ynabUserId", "clientId", "credentialId", "writesEnabled"].every((key) => a[key] === b[key]);
}

export function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

export function base64url(bytes) {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 4096) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 4096));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
    // Workers supports "follow" and "manual", but not the browser-standard
    // "error" mode. Keep OAuth credentials pinned to the exact endpoint by
    // returning redirect responses to this code and rejecting them below.
    redirect: "manual",
  });
  assertNoUpstreamRedirect(res, "YNAB token endpoint");
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
    redirect: "manual",
  });
  assertNoUpstreamRedirect(res, "YNAB /user");
  if (!res.ok) throw new Error(`YNAB /user returned HTTP ${res.status}`);
  const json = await res.json();
  const userId = json?.data?.user?.id;
  if (typeof userId !== "string" || !userId) {
    throw new Error("YNAB /user response was missing a user id");
  }
  return userId;
}

export async function saveTokenRecord(storage, binding, record, encryptionSecret) {
  const key = tokenRecordKey(binding);
  const encryptedRecord = await encryptStoredJson(encryptionSecret, key, { binding, tokens: record });
  await storage.put(key, encryptedRecord);
  return encryptedRecord;
}

export async function readTokenRecord(storage, binding, encryptionSecret) {
  // A legacy grant cannot prove which client or consent produced its token.
  // Fail closed instead of importing an ambiguous shared user credential.
  if (!isCredentialBinding(binding)) return null;
  const key = tokenRecordKey(binding);
  const raw = await storage.get(key);
  if (!raw) return null;
  const decoded = await decryptStoredJson(encryptionSecret, key, raw);
  if (decoded.legacy || !credentialBindingsMatch(decoded.value?.binding, binding)) return null;
  return decoded.value.tokens ?? null;
}

// Called only inside the credential Durable Object's serialized queue. A
// rotating refresh is never sent concurrently for one consent credential.
export async function refreshStoredCredential(env, storage, binding) {
  const record = await readTokenRecord(storage, binding, env.DATA_ENCRYPTION_KEY);
  if (!record?.accessToken) return null;
  if (Date.now() < record.expiresAt - REFRESH_SAFETY_WINDOW_MS) {
    return record.accessToken;
  }
  if (!record.refreshToken) return null;
  try {
    const refreshed = await refreshTokens(env, record.refreshToken);
    await saveTokenRecord(storage, binding, refreshed, env.DATA_ENCRYPTION_KEY);
    return refreshed.accessToken;
  } catch {
    // Preserve the encrypted record on failure. An upstream success followed
    // by a lost response/storage failure can still require reconnecting;
    // serialization cannot make the upstream OAuth exchange transactional.
    return null;
  }
}

const CREDENTIAL_ORIGIN = "https://ynab-credentials.internal";

export async function credentialStoreRequest(env, ynabUserId, path, value) {
  if (!env.YNAB_CREDENTIALS) throw new Error("YNAB_CREDENTIALS Durable Object binding is required; reconnect after updating the connector.");
  const stub = env.YNAB_CREDENTIALS.getByName(`ynab-user:${encodeURIComponent(ynabUserId)}`);
  return stub.fetch(`${CREDENTIAL_ORIGIN}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ynabUserId, ...value }),
  });
}

export async function getFreshAccessToken(env, binding) {
  if (!isCredentialBinding(binding)) return null;
  const response = await credentialStoreRequest(env, binding.ynabUserId, "/token", { binding });
  if (response.status === 401) throw new Error("YNAB authorization is unavailable or expired. Reconnect this connector in your MCP client; an older shared credential cannot be migrated safely.");
  if (!response.ok) throw new Error("Could not read the isolated YNAB authorization. Reconnect this connector in your MCP client.");
  return (await response.json()).accessToken;
}

export async function credentialGeneration(env, ynabUserId) {
  const response = await credentialStoreRequest(env, ynabUserId, "/generation", {});
  if (!response.ok) throw new Error("Could not verify the YNAB credential deletion state");
  const { generation } = await response.json();
  if (!Number.isInteger(generation) || generation < 0) throw new Error("Invalid YNAB credential deletion state");
  return generation;
}

// Durable encrypted journal per consent credential. CAS prevents another MCP
// session's read/modify/write from silently losing entries. mutate retries
// only journal transformations, never an outbound financial operation.
export function createKvJournal(env, binding) {
  credentialIdentity(binding);
  let revision;
  async function readVersioned() {
    const response = await credentialStoreRequest(env, binding.ynabUserId, "/journal/read", { binding });
    if (!response.ok) throw new Error("Could not read the YNAB operation journal.");
    return response.json();
  }
  async function persistVersioned(entries, expectedRevision) {
    const response = await credentialStoreRequest(env, binding.ynabUserId, "/journal/persist", { binding, entries, expectedRevision });
    if (response.status === 409) return null;
    if (!response.ok) throw new Error("Could not persist the YNAB operation journal.");
    return (await response.json()).revision;
  }
  return {
    async read() {
      const current = await readVersioned();
      revision = current.revision;
      return current.entries;
    },
    async persist(entries) {
      if (revision === undefined) revision = (await readVersioned()).revision;
      const next = await persistVersioned(entries, revision);
      if (next === null) throw new Error("YNAB operation journal changed concurrently; reread its state before continuing.");
      revision = next;
    },
    async mutate(transform) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const current = await readVersioned();
        const result = await transform(current.entries);
        const next = await persistVersioned(current.entries, current.revision);
        if (next !== null) {
          revision = next;
          return result;
        }
      }
      throw new Error("YNAB operation journal changed concurrently; retry the journal state update.");
    },
  };
}
