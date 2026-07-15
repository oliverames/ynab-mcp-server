// MCP streamable HTTP endpoints must reject untrusted browser Origins before
// they reach the OAuth provider. Requests without Origin are native/server
// clients and remain valid under the MCP transport specification.

const MCP_ENDPOINTS = new Set(["/mcp", "/sse"]);

function configuredOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

function browserOrigin(value) {
  const origin = configuredOrigin(value);
  return origin === value ? origin : null;
}

export function allowedMcpOrigins(env) {
  const configured = [
    env.CONNECTOR_BASE_URL,
    ...(env.MCP_ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()),
  ];
  return new Set(configured.map(configuredOrigin).filter(Boolean));
}

export function rejectUntrustedMcpOrigin(request, env) {
  const url = new URL(request.url);
  if (!MCP_ENDPOINTS.has(url.pathname)) return null;

  const originHeader = request.headers.get("Origin");
  if (!originHeader) return null;

  const origin = browserOrigin(originHeader);
  if (origin && allowedMcpOrigins(env).has(origin)) return null;

  return Response.json(
    {
      error: "invalid_origin",
      error_description: "Browser Origin is not permitted for this MCP endpoint.",
    },
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        Vary: "Origin",
      },
    }
  );
}
