// Durable Object-backed MCP agent: one instance per authenticated session.
// The entire tool/prompt/resource surface comes from the shared factory in
// the repo root (same code the local stdio server runs); this file only
// supplies the consent-bound token getter, write flag, and durable journal.

import { McpAgent } from "agents/mcp";
import { createYnabServer } from "../../index.js";
import { REMOTE_SERVER_INFO } from "./brand-assets.js";
import { hostedServerOptions } from "./hosted-options.js";

export class YnabMCP extends McpAgent {
  // agents v0.17.4 otherwise durably logs response messages for SSE replay.
  // Financial results/previews stay in memory; interrupted financial writes
  // are recovered from the encrypted operation journal after fresh approval.
  getEventStore() {
    return undefined;
  }

  async init() {
    const { server } = createYnabServer({
      // Called per outbound YNAB request; handles the 2-hour token expiry by
      // refreshing (and rotating the refresh token) inside the safety window.
      ...hostedServerOptions(this.env, this.props, this.name),
      serverInfo: REMOTE_SERVER_INFO,
    });
    this.server = server;
  }
}
