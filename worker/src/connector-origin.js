// A custom-domain migration keeps each OAuth issuer and resource intact.
// Never derive an accepted origin from Host, Origin, or forwarded headers.

function configuredOrigin(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("A connector origin is required");
  }
  const url = new URL(value.trim());
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("Connector origins must be HTTPS origins (HTTP loopback is allowed for development)");
  }
  return url.origin;
}

export function connectorOrigins(env, defaultOrigin) {
  const canonicalOrigin = configuredOrigin(env.CONNECTOR_BASE_URL || defaultOrigin);
  const compatibilityOrigins = (env.CONNECTOR_COMPATIBILITY_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map(configuredOrigin);
  return {
    canonicalOrigin,
    allowedOrigins: new Set([canonicalOrigin, ...compatibilityOrigins]),
  };
}

function originError(status, error, description) {
  return Response.json({ error, error_description: description }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createOriginScopedOAuthRouter({
  createProvider,
  providerOptions,
  defaultOrigin,
  beforeFetch,
}) {
  // Provider construction is deferred until a configured-origin request. The
  // cache holds policy only; all storage bindings and secrets stay request-local.
  const providers = new Map();

  return {
    async fetch(request, env, ctx) {
      let configuration;
      try {
        configuration = connectorOrigins(env, defaultOrigin);
      } catch {
        return originError(500, "invalid_connector_configuration", "Connector origins are not configured correctly.");
      }
      const requestedOrigin = new URL(request.url).origin;
      if (!configuration.allowedOrigins.has(requestedOrigin)) {
        return originError(421, "unconfigured_connector_origin", "This origin is not configured for the connector.");
      }

      const requestEnv = {
        ...env,
        CONNECTOR_CANONICAL_URL: configuration.canonicalOrigin,
        CONNECTOR_BASE_URL: requestedOrigin,
      };
      const rejection = beforeFetch?.(request, requestEnv);
      if (rejection) return rejection;

      let provider = providers.get(requestedOrigin);
      if (!provider) {
        const resourceMetadata = {
          ...providerOptions.resourceMetadata,
          resource: `${requestedOrigin}/mcp`,
          authorization_servers: [requestedOrigin],
        };
        // The library allows HTTP resource identifiers for local development,
        // but explicit authorization_servers must be HTTPS. For the already
        // validated loopback origin, discovery derives the local issuer from
        // the token endpoint instead. HTTPS production remains explicitly pinned.
        if (requestedOrigin.startsWith("http:")) delete resourceMetadata.authorization_servers;
        provider = createProvider({
          ...providerOptions,
          resourceMetadata,
        });
        providers.set(requestedOrigin, provider);
      }
      return provider.fetch(request, requestEnv, ctx);
    },
  };
}
