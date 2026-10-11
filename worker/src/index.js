// Entry point: OAuth 2.1 provider wrapping the MCP endpoints.
// /mcp (streamable HTTP, current standard) and /sse (legacy) require a valid
// connector token; everything else falls through to the Hono handler
// (landing, consent, YNAB OAuth dance, privacy, deletion).

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { CONNECTOR_ORIGIN, CONNECTOR_RESOURCE_METADATA } from "./brand-assets.js";
import { createOriginScopedOAuthRouter } from "./connector-origin.js";
import { rejectUntrustedMcpOrigin } from "./mcp-origin.js";
import { applyTransportSecurityHeaders } from "./response-security.js";
import { YnabMCP } from "./ynab-mcp.js";
import { OAuthTransientState } from "./oauth-transient-state.js";
import { OAuthCredentials } from "./oauth-credentials.js";
import { withCredentialMcpNamespace } from "./mcp-session-isolation.js";
import { YnabHandler } from "./ynab-handler.js";

export { YnabMCP, OAuthTransientState, OAuthCredentials };

const oauthRouter = createOriginScopedOAuthRouter({
  createProvider: (options) => new OAuthProvider(options),
  defaultOrigin: CONNECTOR_ORIGIN,
  beforeFetch: rejectUntrustedMcpOrigin,
  providerOptions: {
    apiHandlers: {
      "/mcp": withCredentialMcpNamespace(YnabMCP.serve("/mcp")),
      "/sse": withCredentialMcpNamespace(YnabMCP.serveSSE("/sse")),
    },
    defaultHandler: YnabHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: ["read", "write"],
    resourceMetadata: CONNECTOR_RESOURCE_METADATA,
    // OAuth 2.1 clients used by Claude, ChatGPT, and Le Chat support S256.
    // Do not advertise or accept unprotected plain PKCE challenges.
    allowPlainPKCE: false,
  },
});

export default {
  async fetch(request, env, ctx) {
    const response = await oauthRouter.fetch(request, env, ctx);
    return applyTransportSecurityHeaders(request, response);
  },
};
