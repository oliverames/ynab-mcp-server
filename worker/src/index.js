// Entry point: OAuth 2.1 provider wrapping the MCP endpoints.
// /mcp (streamable HTTP, current standard) and /sse (legacy) require a valid
// connector token; everything else falls through to the Hono handler
// (landing, consent, YNAB OAuth dance, privacy, deletion).

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { YnabMCP } from "./ynab-mcp.js";
import { YnabHandler } from "./ynab-handler.js";

export { YnabMCP };

export default new OAuthProvider({
  apiHandlers: {
    "/mcp": YnabMCP.serve("/mcp"),
    "/sse": YnabMCP.serveSSE("/sse"),
  },
  defaultHandler: YnabHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
});
