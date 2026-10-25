import { createHash, randomBytes } from "node:crypto";

// OAuth 2.1 client helpers for the hosted connector's own authorization server
// (@cloudflare/workers-oauth-provider). Everything takes an injectable `fetch`
// so the tests can run against a local mock. Secrets never appear in thrown
// messages: only the server's `error` and `error_description` are surfaced.

export const DEFAULT_HOSTED_URL = "https://ames-ynab.link/mcp";
export const SMOKE_CLIENT_NAME = "YNAB MCP hosted smoke check";

export class HostedOAuthError extends Error {
  constructor(message, { code } = {}) {
    super(message);
    this.name = "HostedOAuthError";
    this.code = code;
  }
}

function base64url(buffer) {
  return buffer.toString("base64url");
}

export function pkcePair() {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function randomState() {
  return base64url(randomBytes(24));
}

async function readJson(response, what) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new HostedOAuthError(`${what} returned HTTP ${response.status} with a non-JSON body`);
  }
  if (!response.ok) {
    const code = typeof body.error === "string" ? body.error : undefined;
    const description = typeof body.error_description === "string" ? body.error_description : "";
    throw new HostedOAuthError(
      `${what} failed: HTTP ${response.status}${code ? ` ${code}` : ""}${description ? ` (${description})` : ""}`,
      { code },
    );
  }
  return body;
}

export async function discoverEndpoints(mcpUrl, fetchImpl = fetch) {
  const origin = new URL(mcpUrl).origin;
  const response = await fetchImpl(`${origin}/.well-known/oauth-authorization-server`, {
    headers: { accept: "application/json" },
  });
  const metadata = await readJson(response, "OAuth discovery");
  for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
    if (typeof metadata[key] !== "string") {
      throw new HostedOAuthError(`OAuth discovery did not advertise ${key}`);
    }
  }
  // Tokens and the authorization redirect only ever go to the connector's own origin.
  for (const key of ["issuer", "authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
    if (new URL(metadata[key]).origin !== origin) {
      throw new HostedOAuthError(`OAuth discovery ${key} points outside ${origin}; refusing to continue`);
    }
  }
  if (metadata.code_challenge_methods_supported && !metadata.code_challenge_methods_supported.includes("S256")) {
    throw new HostedOAuthError("The authorization server does not support PKCE S256");
  }
  return metadata;
}

// A public client (no secret). Loopback redirect URIs may use any port at
// authorization time (RFC 8252 section 7.3), which the provider implements.
export async function registerPublicClient(endpoints, { redirectUri, clientName = SMOKE_CLIENT_NAME }, fetchImpl = fetch) {
  const response = await fetchImpl(endpoints.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const registered = await readJson(response, "Client registration");
  if (typeof registered.client_id !== "string" || !registered.client_id) {
    throw new HostedOAuthError("Client registration did not return a client_id");
  }
  return registered.client_id;
}

export function buildAuthorizeUrl(endpoints, { clientId, redirectUri, state, challenge, resource, scope = "read" }) {
  const url = new URL(endpoints.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    resource,
  }).toString();
  return url.href;
}

async function tokenRequest(endpoints, params, fetchImpl, what) {
  const response = await fetchImpl(endpoints.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await readJson(response, what);
  if (typeof body.access_token !== "string") {
    throw new HostedOAuthError(`${what} did not return an access_token`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : null,
    expiresIn: body.expires_in,
    scope: body.scope,
  };
}

export function exchangeCode(endpoints, { clientId, code, redirectUri, verifier, resource }, fetchImpl = fetch) {
  return tokenRequest(endpoints, {
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource,
  }, fetchImpl, "Authorization code exchange");
}

export function refreshTokens(endpoints, { clientId, refreshToken, resource }, fetchImpl = fetch) {
  return tokenRequest(endpoints, {
    grant_type: "refresh_token",
    client_id: clientId,
    refresh_token: refreshToken,
    resource,
  }, fetchImpl, "Refresh token exchange");
}
