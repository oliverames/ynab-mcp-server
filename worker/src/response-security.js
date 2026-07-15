const HSTS_VALUE = "max-age=31536000";

// HSTS is deliberately scoped to this hostname. Do not add includeSubDomains
// because this connector does not control every amesvt.com subdomain.
export function applyTransportSecurityHeaders(request, response) {
  if (new URL(request.url).protocol !== "https:") return response;

  const headers = new Headers(response.headers);
  headers.set("Strict-Transport-Security", HSTS_VALUE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
