import { credentialIdentity, isCredentialBinding, sha256base64url } from "./ynab-oauth.js";

// McpAgent addresses objects using an MCP session ID supplied by the client.
// Bind the public opaque session component to authenticated grant props.
// Keep the exact same protocol:name string for native idFromName, PartyServer
// setName, and McpAgent transport/session parsing; do not rewrite DO names.
export function scopedMcpNamespace(namespace, scopeHash) {
  return new Proxy(namespace, {
    get(target, property) {
      if (property === "newUniqueId") {
        return () => {
          const sessionId = `${scopeHash}.${target.newUniqueId().toString()}`;
          return { toString: () => sessionId };
        };
      }
      if (property === "jurisdiction" && typeof target.jurisdiction === "function") {
        return (jurisdiction) => scopedMcpNamespace(target.jurisdiction(jurisdiction), scopeHash);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function withCredentialMcpNamespace(handler) {
  return {
    async fetch(request, env, ctx) {
      if (request.method === "OPTIONS") return handler.fetch(request, env, ctx);
      const props = ctx?.props;
      // Legacy grants reach only the factory's discovery mode, but their
      // sessions must still be separate across YNAB users and from v2 grants.
      const scope = isCredentialBinding(props) ? `consent:${credentialIdentity(props)}`
        : typeof props?.ynabUserId === "string" && props.ynabUserId ? `legacy:${encodeURIComponent(props.ynabUserId)}` : null;
      if (!scope) return Response.json({ error: "invalid_grant", error_description: "Reconnect the YNAB connector in your MCP client." }, { status: 401 });
      const scopeHash = await sha256base64url(`ynab-mcp-session-v2:${scope}`);
      const url = new URL(request.url);
      const sessionIds = [request.headers.get("mcp-session-id"), url.searchParams.get("sessionId")].filter((id) => id !== null);
      for (const id of sessionIds) {
        if (!id.startsWith(`${scopeHash}.`) || !/^[A-Za-z0-9_-]{1,128}$/.test(id.slice(scopeHash.length + 1))) {
          return Response.json({ error: "invalid_session", error_description: "This MCP session does not belong to the authenticated consent. Reconnect this client." }, { status: 403 });
        }
      }
      return handler.fetch(request, { ...env, MCP_OBJECT: scopedMcpNamespace(env.MCP_OBJECT, scopeHash) }, ctx);
    },
  };
}
