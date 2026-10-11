const TRANSIENT_ORIGIN = "https://oauth-transient-state.internal";
export const LEGACY_CONNECTOR_ORIGIN = "https://ynab.amesvt.com";

export function transientStateMatchesOrigin(value, expectedOrigin, legacyOrigin) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  // Only records written before origin binding may omit the field. An
  // explicitly malformed field must never fall back to the legacy origin.
  const origin = Object.hasOwn(value, "connectorOrigin")
    ? value.connectorOrigin
    : legacyOrigin;
  return origin === expectedOrigin;
}

function isOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}

// Shared with the Durable Object and tests so origin checks and the one-time
// removal happen in the same production transaction, never in a KV read/delete.
export async function consumeTransientRecord(storage, binding) {
  const { expectedOrigin, legacyOrigin } = binding ?? {};
  if (!isOrigin(expectedOrigin) || legacyOrigin !== LEGACY_CONNECTOR_ORIGIN) {
    return new Response("Invalid transient origin binding", { status: 400 });
  }
  const result = await storage.transaction(async (txn) => {
    const current = await txn.get("record");
    if (!current) return { status: 404 };
    if (!Number.isFinite(current.expiresAt) || current.expiresAt <= Date.now()) {
      await txn.delete("record");
      return { status: 410 };
    }
    if (!transientStateMatchesOrigin(current.value, expectedOrigin, legacyOrigin)) {
      return { status: 409 };
    }
    await txn.delete("record");
    return { status: 200, value: current.value };
  });
  // A request to the wrong domain must leave the original state and alarm
  // usable until its original ten-minute deadline.
  if (result.status === 200 || result.status === 410) await storage.deleteAlarm();
  return result.status === 200
    ? Response.json(result.value)
    : new Response(null, { status: result.status });
}

function transientStub(env, id) {
  if (!env.OAUTH_STATE) throw new Error("OAUTH_STATE Durable Object binding is required");
  return env.OAUTH_STATE.getByName(id);
}

export async function putTransientState(env, id, value, ttlSeconds) {
  const response = await transientStub(env, id).fetch(`${TRANSIENT_ORIGIN}/record`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value, expiresAt: Date.now() + ttlSeconds * 1000 }),
  });
  if (!response.ok) throw new Error(`Could not store transient OAuth state (HTTP ${response.status})`);
}

export async function consumeTransientState(env, id, { expectedOrigin, legacyOrigin }) {
  const response = await transientStub(env, id).fetch(`${TRANSIENT_ORIGIN}/consume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedOrigin, legacyOrigin }),
  });
  if ([404, 409, 410].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Could not consume transient OAuth state (HTTP ${response.status})`);
  return response.json();
}
