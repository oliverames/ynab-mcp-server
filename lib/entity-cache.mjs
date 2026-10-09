import { randomUUID } from "node:crypto";

const clone = (value) => structuredClone(value);
const validCursor = (value) => Number.isSafeInteger(value) && value >= 0;

// A cache is owned by exactly one server instance. Credentials, sessions and
// budgets never share a registry, including when their entity IDs happen to
// match. The names are opaque identifiers, never bearer tokens.
export function createEntityCache({ tenantId = randomUUID(), sessionId = randomUUID(), ttlMs = 30_000, now = Date.now, maxEntries = 32, maxBytes = 16 * 1024 * 1024 } = {}) {
  if (!tenantId || !sessionId) throw new Error("Cache tenantId and sessionId are required");
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new Error("Cache TTL must be nonnegative");
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error("Cache maxEntries must be a positive integer");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Cache maxBytes must be a positive integer");
  const entries = new Map();
  const pending = new Map();
  let generation = 0;
  let storedBytes = 0;

  function remove(key) {
    const existing = entries.get(key);
    if (existing) storedBytes -= existing.bytes;
    entries.delete(key);
  }

  function keyFor({ budgetId, resource, scope = "all" }) {
    return JSON.stringify([tenantId, sessionId, budgetId, resource, scope]);
  }

  function invalidate(budgetId) {
    // Also invalidate in-flight responses: a read that started before a write
    // cannot repopulate the cache afterwards, even if the write timed out.
    generation += 1;
    if (budgetId === undefined) { entries.clear(); storedBytes = 0; }
    else for (const [key, entry] of entries) if (entry.budgetId === budgetId) remove(key);
    pending.clear();
  }

  function merge(previous, rows, resource, reset) {
    const merged = reset ? new Map() : new Map(previous);
    let tombstones = 0;
    for (const row of rows) {
      if (!row || typeof row.id !== "string") throw new Error(`Invalid ${resource} cache row: missing ID`);
      if (row.deleted) {
        merged.delete(row.id);
        tombstones += 1;
        continue;
      }
      const incoming = clone(row);
      if (resource === "category_groups" && Array.isArray(row.categories)) {
        // Category deltas may contain a subset of a group's categories. A
        // category may also move groups, so remove its previous membership.
        for (const category of row.categories) {
          for (const [otherId, other] of merged) {
            if (otherId !== row.id && other.categories?.some((item) => item.id === category.id)) {
              merged.set(otherId, { ...other, categories: other.categories.filter((item) => item.id !== category.id) });
            }
          }
        }
        const oldCategories = reset ? [] : merged.get(row.id)?.categories || [];
        const children = new Map(oldCategories.map((category) => [category.id, category]));
        for (const category of row.categories) {
          if (category.deleted) { children.delete(category.id); tombstones += 1; }
          else children.set(category.id, clone(category));
        }
        incoming.categories = [...children.values()];
      }
      merged.set(row.id, incoming);
    }
    return { merged, tombstones };
  }

  function result(entry, source, reason) {
    let rows = [...entry.rows.values()].map(clone);
    if (entry.resource === "transactions") rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
    return {
      [entry.resource]: rows,
      server_knowledge: entry.cursor ?? undefined,
      freshness: {
        source,
        fetched_at: new Date(entry.fetchedAt).toISOString(),
        age_ms: Math.max(0, now() - entry.fetchedAt),
        ttl_ms: ttlMs,
        complete: true,
        coverage: clone(entry.coverage),
        server_knowledge: entry.cursor,
        refresh: reason,
        tombstones_removed: entry.tombstones,
      },
    };
  }

  function covers(existingCoverage, requestedCoverage) {
    return !requestedCoverage.since_date || !existingCoverage.since_date || existingCoverage.since_date <= requestedCoverage.since_date;
  }

  async function read({ budgetId, resource, scope = "all", coverage = { kind: "all_entities" }, load, forceRefresh = false, deltaSupported = true }) {
    if (!budgetId || !resource || typeof load !== "function") throw new Error("Cache read requires budget, resource and loader");
    const key = keyFor({ budgetId, resource, scope });
    const existing = entries.get(key);
    const expandsCoverage = existing && !covers(existing.coverage, coverage);
    if (existing && !expandsCoverage && !forceRefresh && now() - existing.fetchedAt < ttlMs) return result(existing, "cache", "ttl_hit");
    const inFlight = pending.get(key);
    if (inFlight) {
      if (covers(inFlight.coverage, coverage)) return clone(await inFlight.promise);
      // A concurrent narrow baseline cannot satisfy an older-history read.
      // Finish it first, then replace it with the expanded baseline.
      await inFlight.promise.catch(() => {});
      return read({ budgetId, resource, scope, coverage, load, forceRefresh, deltaSupported });
    }
    const effectiveCoverage = clone(coverage);
    if (existing?.coverage.since_date && effectiveCoverage.since_date && existing.coverage.since_date < effectiveCoverage.since_date) effectiveCoverage.since_date = existing.coverage.since_date;
    const readGeneration = generation;
    const promise = (async () => {
      const deltaCursor = deltaSupported && !expandsCoverage ? existing?.cursor ?? undefined : undefined;
      let data = await load(deltaCursor, effectiveCoverage);
      let reset = !existing || deltaCursor === undefined;
      let reason = expandsCoverage ? "coverage_expansion" : reset ? existing && !deltaSupported ? "scoped_full_refresh" : "full_baseline" : "delta_merge";
      // A lower cursor means the server's knowledge timeline was reset. A
      // full baseline replaces prior history; never append the new timeline.
      if (!reset && (!validCursor(data.server_knowledge) || data.server_knowledge < deltaCursor)) {
        data = await load(undefined, effectiveCoverage);
        reset = true;
        reason = "cursor_reset";
      }
      if (!Array.isArray(data?.[resource])) throw new Error(`Invalid ${resource} cache response`);
      const { merged, tombstones } = merge(existing?.rows, data[resource], resource, reset);
      const entry = {
        budgetId, resource, rows: merged,
        cursor: validCursor(data.server_knowledge) ? data.server_knowledge : null,
        fetchedAt: now(), coverage: effectiveCoverage, tombstones,
        bytes: new TextEncoder().encode(JSON.stringify([...merged.values()])).byteLength,
      };
      if (readGeneration === generation) {
        remove(key);
        entries.set(key, entry);
        storedBytes += entry.bytes;
        while (entries.size > maxEntries || storedBytes > maxBytes) remove(entries.keys().next().value);
      }
      const output = result(entry, "network", reason);
      output.freshness.cache_stored = entries.get(key) === entry;
      if (readGeneration !== generation) {
        output.freshness.invalidated_during_read = true;
        output.freshness.complete = false;
      }
      return output;
    })();
    const flight = { promise, coverage: effectiveCoverage };
    pending.set(key, flight);
    try { return await promise; }
    finally { if (pending.get(key) === flight) pending.delete(key); }
  }

  return { read, invalidate, get size() { return entries.size; } };
}
