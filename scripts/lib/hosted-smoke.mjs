import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  DEFAULT_HOSTED_URL,
  HostedOAuthError,
  buildAuthorizeUrl,
  discoverEndpoints,
  exchangeCode,
  pkcePair,
  randomState,
  refreshTokens,
  registerPublicClient,
} from "./hosted-oauth.mjs";
import { packageJson, withHostedClient } from "./smoke-client.mjs";

// The refresh token lives as long as the grant the consent created. The
// provider fixes that lifetime at consent (30 days by default) and rotation
// does not extend it, so warn before it lapses.
export const GRANT_LIFETIME_DAYS = 30;
export const GRANT_WARN_DAYS = 25;
export const CONSENT_COMMAND = "npm run smoke:hosted:consent";

const DAY_MS = 24 * 60 * 60 * 1000;

function grantAgeDays(consentedAt, now) {
  const time = Date.parse(consentedAt ?? "");
  return Number.isNaN(time) ? null : (now() - time) / DAY_MS;
}

// What the hosted Worker should serve for this grant, built from the same
// createYnabServer factory the Worker uses, over an in-memory transport.
export async function localExpectation({ writesEnabled }) {
  process.env.YNAB_MCP_NO_AUTOSTART ??= "1";
  process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK ??= "1";
  const { createYnabServer } = await import("../../index.js");
  const { server } = createYnabServer({
    getAccessToken: async () => "unused-local-expectation",
    hasCredentials: true,
    writesEnabled,
  });
  const client = new Client({ name: "ynab-mcp-smoke-expectation", version: packageJson.version });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    return {
      toolNames: tools.map((tool) => tool.name).sort(),
      instructions: client.getInstructions() ?? "",
      version: packageJson.version,
    };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function runHostedSmoke({
  store,
  url = DEFAULT_HOSTED_URL,
  fetchImpl = fetch,
  log = console.log,
  now = Date.now,
  expectation = localExpectation,
}) {
  const stored = await store.read();
  if (!stored) {
    throw new Error(`No consent token in ${store.describe()}. Run once, with a browser: ${CONSENT_COMMAND}`);
  }
  if (stored.mcpUrl && stored.mcpUrl !== url) {
    throw new Error(`The stored token was issued for ${stored.mcpUrl}, not ${url}. Re-run: ${CONSENT_COMMAND} -- --url ${url}`);
  }
  const ageDays = grantAgeDays(stored.consentedAt, now);
  if (ageDays !== null && ageDays >= GRANT_WARN_DAYS) {
    log(`Warning: consent is ${Math.floor(ageDays)} days old and the grant lasts ${GRANT_LIFETIME_DAYS}. Renew soon with: ${CONSENT_COMMAND}`);
  }

  const endpoints = await discoverEndpoints(url, fetchImpl);

  let tokens;
  try {
    tokens = await refreshTokens(endpoints, { clientId: stored.clientId, refreshToken: stored.refreshToken, resource: url }, fetchImpl);
  } catch (error) {
    if (error instanceof HostedOAuthError && (error.code === "invalid_grant" || error.code === "invalid_client")) {
      throw new Error(`${error.message}. The consent grant has expired or was revoked. Renew it with a browser: ${CONSENT_COMMAND}`);
    }
    throw error;
  }

  // Persist the rotated refresh token before using the session. The provider
  // keeps the previous token valid for one more exchange, so a failed
  // write-back is recoverable and only warrants a warning.
  let rotation = "server did not rotate the refresh token";
  if (tokens.refreshToken && tokens.refreshToken !== stored.refreshToken) {
    try {
      await store.save({ refreshToken: tokens.refreshToken });
      rotation = "rotated and saved to 1Password";
    } catch (error) {
      rotation = "rotated but NOT saved";
      log(`Warning: could not save the rotated refresh token (${error.message}). The previous token still works for one more run.`);
    }
  }

  const scopes = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
  const writesEnabled = scopes.includes("write");
  const expected = await expectation({ writesEnabled });

  const failures = [];
  const observed = await withHostedClient({ url, bearerToken: tokens.accessToken }, async (client) => {
    const { tools } = await client.listTools();
    return {
      toolNames: tools.map((tool) => tool.name).sort(),
      instructions: client.getInstructions(),
      version: client.getServerVersion()?.version,
    };
  });

  if (observed.version !== expected.version) {
    failures.push(`server version ${observed.version ?? "(none)"} does not match this checkout's ${expected.version}`);
  }
  if (typeof observed.instructions !== "string" || observed.instructions.length === 0) {
    failures.push("initialize returned no instructions");
  } else if (observed.instructions !== expected.instructions) {
    failures.push(`instructions differ from this checkout (${observed.instructions.length} vs ${expected.instructions.length} characters)`);
  }
  const missing = expected.toolNames.filter((name) => !observed.toolNames.includes(name));
  const unexpected = observed.toolNames.filter((name) => !expected.toolNames.includes(name));
  if (missing.length > 0) failures.push(`missing tools: ${missing.join(", ")}`);
  if (unexpected.length > 0) failures.push(`unexpected tools: ${unexpected.join(", ")}`);
  if (observed.toolNames.length !== expected.toolNames.length) {
    failures.push(`tool count ${observed.toolNames.length}, expected ${expected.toolNames.length}`);
  }

  const unauthenticated = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  if (unauthenticated.status !== 401) {
    failures.push(`unauthenticated POST returned HTTP ${unauthenticated.status}, expected 401`);
  }

  log(`Connected to ${url}`);
  log(`Server version ${observed.version ?? "(none)"}; ${observed.toolNames.length} tools (${writesEnabled ? "read and write" : "read-only"} grant); instructions ${observed.instructions?.length ?? 0} characters`);
  log(`Refresh token: ${rotation}`);
  if (failures.length > 0) {
    throw new Error(`Hosted smoke check failed:\n- ${failures.join("\n- ")}`);
  }
  log("Hosted smoke check passed (read-only; no tool was called).");
  return { toolCount: observed.toolNames.length, version: observed.version, writesEnabled };
}

function waitForCallback(server, { expectedState, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No browser callback within ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
    server.on("request", (request, response) => {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (requestUrl.pathname !== "/callback") {
        response.writeHead(404).end();
        return;
      }
      const params = requestUrl.searchParams;
      const finish = (status, message, settle) => {
        response.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(`<!doctype html><title>YNAB MCP smoke consent</title><p>${message}</p>`);
        clearTimeout(timer);
        settle();
      };
      if (params.get("state") !== expectedState) {
        finish(400, "State mismatch. Close this tab and start again.", () => reject(new Error("Callback state did not match; aborting")));
      } else if (params.get("error")) {
        finish(400, "Authorization was not granted. You can close this tab.", () => reject(new Error(`Authorization failed: ${params.get("error")}`)));
      } else if (!params.get("code")) {
        finish(400, "No authorization code. Close this tab and start again.", () => reject(new Error("Callback carried no authorization code")));
      } else {
        finish(200, "Consent received. You can close this tab and return to the terminal.", () => resolve({ code: params.get("code"), iss: params.get("iss") }));
      }
    });
  });
}

export async function runHostedConsent({
  store,
  url = DEFAULT_HOSTED_URL,
  fetchImpl = fetch,
  log = console.log,
  now = Date.now,
  openBrowser,
  timeoutMs = 5 * 60 * 1000,
}) {
  const endpoints = await discoverEndpoints(url, fetchImpl);

  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
    const clientId = await registerPublicClient(endpoints, { redirectUri }, fetchImpl);
    const { verifier, challenge } = pkcePair();
    const state = randomState();
    const authorizeUrl = buildAuthorizeUrl(endpoints, { clientId, redirectUri, state, challenge, resource: url });

    const callback = waitForCallback(server, { expectedState: state, timeoutMs });
    callback.catch(() => {});
    log("Approve the connector in your browser. On the consent page, leave the write-access box unchecked.");
    log(authorizeUrl);
    await openBrowser(authorizeUrl);
    const { code, iss } = await callback;

    if (iss && iss !== endpoints.issuer) {
      throw new Error("Callback issuer did not match the connector; aborting");
    }
    const tokens = await exchangeCode(endpoints, { clientId, code, redirectUri, verifier, resource: url }, fetchImpl);
    if (!tokens.refreshToken) {
      throw new Error("The server issued no refresh token, so there is nothing to reuse");
    }
    if ((tokens.scope ?? "").split(/\s+/).includes("write")) {
      throw new Error("The grant includes write access, which the smoke check does not need. Nothing was stored. Run it again and leave the write-access box unchecked.");
    }
    const outcome = await store.save({
      refreshToken: tokens.refreshToken,
      clientId,
      mcpUrl: url,
      consentedAt: new Date(now()).toISOString(),
    });
    log(`Consent stored (${outcome}) in ${store.describe()}. It lasts about ${GRANT_LIFETIME_DAYS} days. Check it with: npm run smoke:hosted`);
    return { clientId, scope: tokens.scope };
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}
