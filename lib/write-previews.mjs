import { createHash, randomUUID } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const hashToken = token => createHash('sha256').update(String(token)).digest('hex');

// Tokens are ephemeral capabilities to a reviewed plan, never proof of human
// consent. The tool layer independently requires confirmed:true.
//
// Local stdio keeps previews in this process and binds them to the MCP session.
// A hosted caller passes `store` ({ put, claim }) to keep them in durable
// storage instead. Hosted clients may open a new MCP session for every tool
// call, so a stored preview is bound to the authenticated tenant only, and the
// store sees a hash of the token, the plan fingerprint and the expiry. claim()
// must read and delete in one step so each preview stays single-use.
export function createWritePreviews({ tenantId, sessionId, ttlMs = 300000, now = Date.now, maxEntries = 100, store = null }) {
  const previews = new Map();
  const scope = store ? { tenantId } : { tenantId, sessionId };
  const purge = () => { for (const [key, value] of previews) if (value.expires <= now()) previews.delete(key); };
  return {
    async issue(plan) {
      const token = randomUUID();
      const expires = now() + ttlMs;
      const bound = fingerprint({ ...scope, plan });
      if (store) {
        await store.put({ tokenHash: hashToken(token), fingerprint: bound, expires, now: now() });
      } else {
        purge();
        if (previews.size >= maxEntries) previews.delete(previews.keys().next().value);
        previews.set(token, { fingerprint: bound, expires });
      }
      return { preview_token: token, expires_at: new Date(expires).toISOString(), fingerprint: fingerprint(plan), plan, human_approval_required: true, limits: 'Fresh state is compared immediately before execution. YNAB offers no conditional writes or atomic multi-step transaction; external changes can still race the final read and write.' };
    },
    async claim(token) {
      let stored;
      if (store) {
        stored = await store.claim(hashToken(token));
      } else {
        stored = previews.get(token);
        previews.delete(token);
        purge();
      }
      if (!stored || stored.expires <= now()) throw new Error('Preview token is missing, expired, already used, or belongs to another authenticated session or consent. Request a new preview.');
      return plan => {
        if (stored.expires <= now()) throw new Error('Preview token expired while reading fresh state. No write attempted.');
        if (stored.fingerprint !== fingerprint({ ...scope, plan })) throw new Error('Stale preview: exact transaction IDs, proposed values, budget, or current state changed. No write was attempted; request a new preview and explicit approval.');
      };
    },
    async consume(token, plan) { (await this.claim(token))(plan); },
  };
}
