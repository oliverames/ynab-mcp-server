// Entry point: OAuth 2.1 provider wrapping the MCP endpoints.
// /mcp (streamable HTTP, current standard) and /sse (legacy) require a valid
// connector token; everything else falls through to the Hono handler
// (landing, consent, YNAB OAuth dance, privacy, deletion).

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { CONNECTOR_RESOURCE_METADATA } from "./brand-assets.js";
import { YnabMCP } from "./ynab-mcp.js";
import { OAuthTransientState } from "./oauth-transient-state.js";
import { YnabHandler } from "./ynab-handler.js";

export { YnabMCP, OAuthTransientState };

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": YnabMCP.serve("/mcp"),
    "/sse": YnabMCP.serveSSE("/sse"),
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
});
