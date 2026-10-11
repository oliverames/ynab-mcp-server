import { connectorOrigins } from "./connector-origin.js";

function isExactResource(value, resource) {
  // Match the pinned provider's exact-resource rule, including a legacy
  // singleton representation. Empty, repeated, or mixed resource arrays are
  // not accepted by its configured-resource policy.
  return value === resource || (Array.isArray(value) && value.length === 1 && value[0] === resource);
}

// The provider's default replacement policy spans every resource for a
// user/client pair. Domain compatibility instead replaces only grants whose
// stored resource belongs to this exact origin. Public summaries omit resource;
// read the record privately and retain only its non-secret grant ID.
export async function captureSameOriginGrantIds(env, oauthProvider, { userId, clientId }) {
  if (!userId || !clientId || typeof oauthProvider?.listUserGrants !== "function" ||
      typeof env.OAUTH_KV?.get !== "function") {
    throw new Error("Grant replacement requires configured provider storage and identity");
  }
  const resource = `${connectorOrigins(env).canonicalOrigin}/mcp`;
  const grantIds = new Set();
  const cursors = new Set();
  let cursor;
  do {
    const page = await oauthProvider.listUserGrants(userId, { cursor, limit: 100 });
    if (!Array.isArray(page?.items)) throw new Error("Could not inspect existing connector grants");
    for (const summary of page.items) {
      if (summary?.userId !== userId || summary?.clientId !== clientId || typeof summary.id !== "string") continue;
      const stored = await env.OAUTH_KV.get(`grant:${userId}:${summary.id}`, { type: "json" });
      if (stored?.id === summary.id && stored.userId === userId && stored.clientId === clientId && isExactResource(stored.resource, resource)) {
        grantIds.add(summary.id);
      }
    }
    cursor = page.cursor;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error("Could not finish inspecting existing connector grants");
      cursors.add(cursor);
    }
  } while (cursor);
  return [...grantIds];
}

// Call only after the new provider grant and its consent credential succeed.
// The captured inventory never includes the new grant or another origin's
// grant, including grants concurrently created after capture.
export async function revokeCapturedGrants(oauthProvider, userId, grantIds) {
  // Match the provider's best-effort replacement cleanup. A partial cleanup
  // failure must never roll back a valid new consent after old grants have
  // already been revoked. Remaining old grants are still user-deletable.
  await Promise.allSettled(grantIds.map(async (grantId) => oauthProvider.revokeGrant(grantId, userId)));
}
