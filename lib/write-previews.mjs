import { createHash, randomUUID } from 'node:crypto';

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, canonical(value[k])]));
  return value;
}

export function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

const MISSING_PREVIEW = 'Preview token is missing, expired, already used, or belongs to another authenticated session. Request a new preview.';

function previewResult(token, expires, plan) {
  return { preview_token: token, expires_at: new Date(expires).toISOString(), fingerprint: fingerprint(plan), plan, human_approval_required: true, limits: 'Fresh state is compared immediately before execution. YNAB offers no conditional writes or atomic multi-step transaction; external changes can still race the final read and write.' };
}

function claimedValidator(stored, bind, now) {
  if (!stored || stored.expires <= now()) throw new Error(MISSING_PREVIEW);
  return plan => {
    if (stored.expires <= now()) throw new Error('Preview token expired while reading fresh state. No write attempted.');
    if (stored.fingerprint !== bind(plan)) throw new Error('Stale preview: exact transaction IDs, proposed values, budget, or current state changed. No write was attempted; request a new preview and explicit approval.');
  };
}

// Tokens are ephemeral capabilities to a reviewed plan, never proof of human
// consent. The tool layer independently requires confirmed:true.
export function createWritePreviews({ tenantId, sessionId, ttlMs = 300000, now = Date.now, maxEntries = 100 }) {
  const previews = new Map();
  const bind = plan => fingerprint({ tenantId, sessionId, plan });
  const purge = () => { for (const [key, value] of previews) if (value.expires <= now()) previews.delete(key); };
  return {
    issue(plan) {
      purge();
      if (previews.size >= maxEntries) previews.delete(previews.keys().next().value);
      const token = randomUUID();
      const expires = now() + ttlMs;
      previews.set(token, { fingerprint: bind(plan), expires });
      return previewResult(token, expires, plan);
    },
    claim(token) {
      const stored = previews.get(token);
      previews.delete(token);
      purge();
      return claimedValidator(stored, bind, now);
    },
    consume(token, plan) { this.claim(token)(plan); },
  };
}

// Hosted clients may open a new MCP session for every tool call, so a preview
// and its approved write can arrive on different sessions of one consent.
// The store is scoped to that consent and must take (read and delete) a token
// atomically. It receives only the bound fingerprint and expiry, never the plan.
export function createStoredWritePreviews({ tenantId, store, ttlMs = 300000, now = Date.now }) {
  const bind = plan => fingerprint({ tenantId, plan });
  return {
    async issue(plan) {
      const token = randomUUID();
      const expires = now() + ttlMs;
      await store.put(token, { fingerprint: bind(plan), expires });
      return previewResult(token, expires, plan);
    },
    async claim(token) {
      return claimedValidator(await store.take(token), bind, now);
    },
    async consume(token, plan) { (await this.claim(token))(plan); },
  };
}
