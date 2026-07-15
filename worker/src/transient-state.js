const TRANSIENT_ORIGIN = "https://oauth-transient-state.internal";

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

export async function consumeTransientState(env, id) {
  const response = await transientStub(env, id).fetch(`${TRANSIENT_ORIGIN}/consume`, {
    method: "POST",
  });
  if (response.status === 404 || response.status === 410) return null;
  if (!response.ok) throw new Error(`Could not consume transient OAuth state (HTTP ${response.status})`);
  return response.json();
}
