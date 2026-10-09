// Independently implemented recovery for exact-value, multi-step YNAB writes.
// Financial calls must never execute inside a retryable journal/CAS callback.
const journalQueues = new WeakMap();
const backingJournal = Symbol("backingJournal");
const TYPE = "durable_operation";
const VERSION = 1;

export class WriteRecoveryError extends Error {
  constructor(code, message, operationId) {
    super(message);
    this.name = "WriteRecoveryError";
    this.code = code;
    if (operationId) this.operationId = operationId;
  }
}

function error(code, message, operationId) {
  return new WriteRecoveryError(code, message, operationId);
}

function originalJournal(journal) {
  return journal?.[backingJournal] ?? journal;
}

async function serialized(journal, task) {
  const previous = journalQueues.get(journal) ?? Promise.resolve();
  const result = previous.catch(() => {}).then(task);
  const tail = result.then(() => {}, () => {});
  journalQueues.set(journal, tail);
  try {
    return await result;
  } finally {
    if (journalQueues.get(journal) === tail) journalQueues.delete(journal);
  }
}

function requireJournal(journal) {
  if (!journal || typeof journal.read !== "function" ||
      (typeof journal.persist !== "function" && typeof journal.mutate !== "function")) {
    throw error("JOURNAL_UNAVAILABLE", "Durable journal storage is required before a multi-step write.");
  }
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  throw error("INVALID_PLAN", "Operation plans and projected state must contain only finite JSON values.");
}

function same(a, b) {
  return canonical(a) === canonical(b);
}

function validateEntries(entries) {
  if (!Array.isArray(entries)) throw error("JOURNAL_INVALID", "Durable journal did not return an entry array.");
  return entries;
}

// Unfinished operations must survive normal undo/audit history pruning.
export function retainJournalEntries(entries, limit = 100) {
  validateEntries(entries);
  const keep = new Set(entries.filter((entry) => entry.type === TYPE && entry.status !== "completed"));
  let recent = 0;
  return entries.filter((entry) => keep.has(entry) || recent++ < limit);
}

async function mutateBacking(journal, callback, limit) {
  if (typeof journal.mutate === "function") {
    // Callback contains journal edits only, so a CAS adapter may replay it safely.
    return journal.mutate(async (entries) => {
      validateEntries(entries);
      const result = await callback(entries);
      const retained = retainJournalEntries(entries, limit);
      entries.splice(0, entries.length, ...retained);
      return result;
    });
  }
  const entries = copy(validateEntries(await journal.read()));
  const result = await callback(entries);
  await journal.persist(retainJournalEntries(entries, limit));
  return result;
}

// Wrap once and use mutate for read-modify-write edits (append and undo as well).
// read followed by persist is deliberately not advertised as an atomic update.
export function createSerializedJournal(journal, { limit = 100 } = {}) {
  if (!journal) return null;
  requireJournal(journal);
  const source = originalJournal(journal);
  return {
    [backingJournal]: source,
    path: journal.path,
    read: () => serialized(source, async () => copy(validateEntries(await source.read()))),
    persist: (entries) => serialized(source, async () => {
      requireJournal(source);
      if (typeof source.persist !== "function") throw error("JOURNAL_INVALID", "Journal supports mutation only; use mutate.");
      await source.persist(retainJournalEntries(copy(entries), limit));
    }),
    mutate: (callback) => serialized(source, () => mutateBacking(source, callback, limit)),
  };
}

function requireScope(scope, sessionRequired = true) {
  for (const key of ["tenantId", "budgetId", ...(sessionRequired ? ["sessionId"] : [])]) {
    if (typeof scope?.[key] !== "string" || !scope[key]) throw error("INVALID_SCOPE", `${key} is required for durable operations.`);
  }
}

function findScoped(entries, scope, sessionRequired = false) {
  const entry = entries.find((candidate) => candidate.type === TYPE && candidate.id === scope.operationId);
  if (!entry || entry.tenant_id !== scope.tenantId || entry.budget_id !== scope.budgetId ||
      (sessionRequired && entry.session_id !== scope.sessionId)) {
    throw error("OPERATION_NOT_FOUND", "No durable operation exists in this authenticated scope.", scope.operationId);
  }
  if (entry.schema_version !== VERSION) throw error("OPERATION_VERSION", "This durable operation uses an unsupported schema.", entry.id);
  return entry;
}

function planFor(input) {
  if (typeof input.operationId !== "string" || !input.operationId || typeof input.tool !== "string" || !input.tool) {
    throw error("INVALID_PLAN", "operationId and tool are required.");
  }
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 1000) {
    throw error("INVALID_PLAN", "An operation requires between 1 and 1000 exact-value steps.", input.operationId);
  }
  const ids = new Set();
  const targets = new Set();
  const steps = input.steps.map((step) => {
    if (typeof step.id !== "string" || !step.id || ids.has(step.id) || typeof step.kind !== "string" || !step.kind ||
        !Object.hasOwn(step, "target") || !Object.hasOwn(step, "before") || !Object.hasOwn(step, "after")) {
      throw error("INVALID_PLAN", "Each step needs a unique id, kind, target, before and after.", input.operationId);
    }
    ids.add(step.id);
    const targetKey = canonical({ kind: step.kind, target: step.target });
    if (targets.has(targetKey)) {
      throw error("INVALID_PLAN", "Operation steps must address distinct targets for unambiguous recovery.", input.operationId);
    }
    targets.add(targetKey);
    return { id: step.id, kind: step.kind, target: step.target, before: step.before, after: step.after };
  });
  const plan = { tool: input.tool, intent: input.intent ?? {}, steps };
  canonical(plan);
  return copy(plan);
}

function summary(entry, extra = {}) {
  return {
    operation_id: entry.id,
    status: entry.status,
    tool: entry.tool,
    completed_steps: entry.steps.filter((step) => step.status === "applied").length,
    total_steps: entry.steps.length,
    recovery_required: entry.status !== "completed",
    steps: entry.steps.map(({ id, kind, status, attempts, outcome }) => ({ id, kind, status, attempts, ...(outcome ? { outcome } : {}) })),
    atomic: false,
    ...extra,
  };
}

/**
 * readStep must perform a fresh read and return exactly the relevant projection
 * in before/after. writeStep must set the recorded absolute after values; it must
 * not recalculate increments, retry, or create non-idempotent entities.
 * Confirmation and exact expiring previews belong in the MCP caller.
 */
export function createDurableOperationRunner({ journal, readStep, writeStep, now = () => new Date().toISOString(), limit = 100 } = {}) {
  const source = originalJournal(journal);
  if (typeof readStep !== "function" || typeof writeStep !== "function") {
    throw error("INVALID_ADAPTER", "Fresh step readers and exact-value writers are required.");
  }

  async function execute(scope, newPlan = null) {
    requireScope(scope);
    requireJournal(source);
    return serialized(source, async () => {
      let entry;
      const entries = validateEntries(await source.read());
      const existing = entries.find((candidate) => candidate.type === TYPE && candidate.id === scope.operationId);
      if (newPlan && !existing) {
        entry = {
          type: TYPE, schema_version: VERSION, id: scope.operationId,
          tenant_id: scope.tenantId, session_id: scope.sessionId, budget_id: scope.budgetId,
          at: now(), updated_at: now(), revision: 0,
          tool: newPlan.tool, intent: newPlan.intent, plan: newPlan,
          status: "prepared", undoable: false,
          steps: newPlan.steps.map((step) => ({ ...step, status: "pending", attempts: 0 })),
        };
      } else {
        entry = copy(findScoped(entries, scope, !!newPlan));
        if (newPlan && !same(entry.plan, newPlan)) {
          throw error("OPERATION_ID_REUSED", "This operation ID already records a different exact plan.", entry.id);
        }
        if (!newPlan && entry.session_id !== scope.sessionId && !scope.allowSessionRebind) {
          throw error("SESSION_REBIND_REQUIRED", "Recovery in a new session requires a newly approved preview and explicit session rebind.", entry.id);
        }
        if (entry.status === "completed") return summary(entry, { replayed: true });
      }

      let persistedRevision = existing ? entry.revision : null;
      async function save() {
        const next = copy({ ...entry, updated_at: now(), revision: (persistedRevision ?? 0) + 1 });
        try {
          await mutateBacking(source, (current) => {
            const index = current.findIndex((candidate) => candidate.type === TYPE && candidate.id === entry.id);
            if ((persistedRevision === null && index >= 0) ||
                (persistedRevision !== null && (index < 0 || current[index].revision !== persistedRevision ||
                  current[index].tenant_id !== entry.tenant_id || current[index].budget_id !== entry.budget_id))) {
              throw error("OPERATION_CONCURRENT_CHANGE", "The durable operation changed concurrently; re-read it before recovery.", entry.id);
            }
            if (index < 0) current.unshift(copy(next));
            else current[index] = copy(next);
          }, limit);
        } catch (cause) {
          if (cause instanceof WriteRecoveryError) throw cause;
          // No adapter error message is persisted or returned: it may contain credentials.
          throw error("JOURNAL_PERSIST_FAILED", "Durable operation state could not be saved. Stop writing and recover using this operation ID.", entry.id);
        }
        entry = next;
        persistedRevision = next.revision;
      }

      // Persist the entire plan before the first financial mutation.
      if (!existing) await save();
      if (!newPlan && entry.session_id !== scope.sessionId) {
        entry.recovery_sessions = [...new Set([...(entry.recovery_sessions ?? []), scope.sessionId])];
        entry.last_session_id = scope.sessionId;
        await save();
      }
      const context = { operationId: entry.id, tenantId: scope.tenantId, sessionId: scope.sessionId, budgetId: scope.budgetId };

      // Every earlier applied step must still match verified after-state before
      // continuing a partial operation. External edits are never overwritten.
      for (let index = 0; index < entry.steps.length; index += 1) {
        const step = entry.steps[index];
        if (step.status !== "applied" && !Object.hasOwn(step, "verified_after")) continue;
        let observed;
        try { observed = await readStep(copy(step), context); }
        catch { entry.status = "unknown"; step.outcome = "read_unavailable"; await save(); return summary(entry); }
        if (!same(observed, step.after)) {
          entry.status = "conflict"; step.status = "conflict"; step.outcome = "verified_after_changed";
          await save(); return summary(entry);
        }
        if (step.status !== "applied") { step.status = "applied"; await save(); }
      }

      // Check every remaining independent target before changing any of them.
      // This prevents an already-stale source allocation from being discovered
      // only after the destination has received its credit.
      for (let index = 0; index < entry.steps.length; index += 1) {
        const step = entry.steps[index];
        if (step.status === "applied") continue;
        let observed;
        try { observed = await readStep(copy(step), context); }
        catch { entry.status = "unknown"; step.outcome = "read_unavailable"; await save(); return summary(entry); }
        if (same(observed, step.after) && (step.attempts > 0 || same(step.before, step.after))) {
          step.status = "applied"; step.verified_after = copy(observed);
          step.outcome = step.attempts > 0 ? "after_observed_on_recovery" : "no_change";
          entry.status = "running"; await save(); continue;
        }
        if (!same(observed, step.before)) {
          step.status = "conflict";
          step.outcome = same(observed, step.after) ? "unexpected_after_without_attempt" : "state_matches_neither_before_nor_after";
          entry.status = "conflict"; await save(); return summary(entry);
        }
      }

      for (let index = 0; index < entry.steps.length; index += 1) {
        let step = entry.steps[index];
        if (step.status === "applied") continue;
        let observed;
        try { observed = await readStep(copy(step), context); }
        catch { entry.status = "unknown"; step.outcome = "read_unavailable"; await save(); return summary(entry); }
        const attempted = step.attempts > 0;
        if (same(observed, step.after) && (attempted || same(step.before, step.after))) {
          step.status = "applied"; step.verified_after = copy(observed); step.outcome = attempted ? "after_observed_on_recovery" : "no_change";
          entry.status = "running"; await save(); continue;
        }
        if (!same(observed, step.before)) {
          step.status = "conflict"; step.outcome = "state_matches_neither_before_nor_after";
          entry.status = "conflict"; await save(); return summary(entry);
        }
        // Persist intent before every attempt. A process crash or journal failure
        // after this point leaves enough evidence for fresh-read recovery.
        step.status = "intent"; step.attempts += 1; delete step.outcome;
        entry.status = "running"; await save(); step = entry.steps[index];
        let writeFailed = false;
        try { await writeStep(copy(step), context); }
        catch { writeFailed = true; }
        let after;
        try { after = await readStep(copy(step), context); }
        catch {
          step.status = "unknown"; step.outcome = "write_outcome_unavailable";
          entry.status = "unknown"; await save(); return summary(entry);
        }
        if (same(after, step.after)) {
          step.status = "applied"; step.verified_after = copy(after);
          step.outcome = writeFailed ? "applied_despite_write_error" : "verified_applied";
          await save(); continue;
        }
        if (same(after, step.before)) {
          step.status = "pending";
          step.outcome = writeFailed ? "before_observed_after_write_error" : "before_observed_after_write";
          entry.status = "partial"; await save(); return summary(entry);
        }
        step.status = "conflict"; step.outcome = "state_matches_neither_before_nor_after";
        entry.status = "conflict"; await save(); return summary(entry);
      }
      entry.status = "completed"; entry.completed_at = now(); await save();
      return summary(entry);
    });
  }

  return {
    run(input) { requireScope(input); return execute(input, planFor(input)); },
    resume(scope) { return execute(scope); },
    async get(scope) {
      requireScope(scope, false); requireJournal(source);
      return serialized(source, async () => copy(findScoped(validateEntries(await source.read()), scope)));
    },
    async list(scope) {
      requireScope(scope, false); requireJournal(source);
      return serialized(source, async () => validateEntries(await source.read())
        .filter((entry) => entry.type === TYPE && entry.tenant_id === scope.tenantId && entry.budget_id === scope.budgetId)
        .map((entry) => summary(entry)));
    },
  };
}
