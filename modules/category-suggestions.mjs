// Independently implemented, deterministic category recommendations. Bank text
// is never parsed as instructions and no external model or write API is used.
const DAY_MS = 86_400_000;
const HISTORY_START = "1970-01-01";
const HALF_LIFE_DAYS = 90;
const RECENT_DAYS = 180;

function dayNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) return null;
  return time / DAY_MS;
}

function activeCategories(categoryGroups) {
  const result = new Map();
  for (const group of categoryGroups ?? []) {
    if (group.deleted || group.hidden || group.internal) continue;
    for (const category of group.categories ?? []) {
      if (!category.id || category.deleted || category.hidden || category.internal) continue;
      result.set(category.id, { id: category.id, name: category.name, group: group.name });
    }
  }
  return result;
}

function isSplit(transaction) {
  return (transaction.subtransactions ?? []).some((part) => !part.deleted);
}

function isTransfer(transaction) {
  return Boolean(transaction.transfer_account_id || transaction.transfer_transaction_id
    || (transaction.subtransactions ?? []).some((part) => !part.deleted
      && (part.transfer_account_id || part.transfer_transaction_id)));
}

function rounded(value) {
  return Math.round(value * 1000) / 1000;
}

function sortNewest(a, b) {
  return String(b.date ?? "").localeCompare(String(a.date ?? ""))
    || String(a.id).localeCompare(String(b.id));
}

function matchSchedules(transaction, schedules, categories) {
  const targetDay = dayNumber(transaction.date);
  return schedules.filter((scheduled) => {
    if (scheduled.deleted || isTransfer(scheduled)
      || (!isSplit(scheduled) && !categories.has(scheduled.category_id))) return false;
    if (scheduled.payee_id !== transaction.payee_id || scheduled.account_id !== transaction.account_id) return false;
    const scheduledDay = dayNumber(scheduled.date_next ?? scheduled.next_date);
    if (scheduledDay === null || targetDay === null || Math.abs(scheduledDay - targetDay) > 7) return false;
    if (!Number.isFinite(scheduled.amount) || scheduled.amount >= 0) return false;
    const tolerance = Math.max(500, Math.abs(scheduled.amount) * 0.01);
    return Math.abs(scheduled.amount - transaction.amount) <= tolerance;
  });
}

/**
 * Computes read-only suggestions from one budget's raw YNAB entities (amounts
 * in milliunits). Confidence is a rule-based support label, not a probability.
 * IDs, never merchant-name similarity or memo prose, define payee identity.
 */
export function computeCategorySuggestions({
  transactions = [],
  categoryGroups = [],
  scheduledTransactions = [],
  transactionIds,
  sinceDate,
  asOfDate = new Date().toISOString().slice(0, 10),
  limit = 50,
} = {}) {
  const asOfDay = dayNumber(asOfDate);
  if (asOfDay === null) throw new Error("asOfDate must be a real YYYY-MM-DD date.");
  if (sinceDate !== undefined && dayNumber(sinceDate) === null) throw new Error("sinceDate must be a real YYYY-MM-DD date.");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be an integer from 1 to 100.");
  if (transactionIds !== undefined && (!Array.isArray(transactionIds) || transactionIds.length > 100
    || transactionIds.some((id) => typeof id !== "string" || !id))) {
    throw new Error("transactionIds must contain at most 100 nonempty transaction IDs.");
  }

  const categories = activeCategories(categoryGroups);
  // A tombstone suppresses an older duplicate live row. Complete merged reads
  // should already be unique, but a repeated row must never add a second vote.
  const byId = new Map();
  for (const transaction of transactions) {
    if (!transaction.id) continue;
    const existing = byId.get(transaction.id);
    if (!existing?.deleted || transaction.deleted) byId.set(transaction.id, transaction);
  }
  const liveTransactions = [...byId.values()].filter((transaction) => !transaction.deleted);
  const histories = new Map();
  for (const transaction of liveTransactions) {
    const date = dayNumber(transaction.date);
    if (!transaction.payee_id || date === null || date > asOfDay) continue;
    if (!histories.has(transaction.payee_id)) histories.set(transaction.payee_id, []);
    histories.get(transaction.payee_id).push(transaction);
  }
  for (const history of histories.values()) history.sort(sortNewest);

  const requestedIds = transactionIds === undefined ? null : [...new Set(transactionIds)];
  const eligibleTargets = requestedIds
    ? requestedIds.map((id) => byId.get(id) ?? { id, missing: true })
    : liveTransactions.filter((transaction) => !transaction.category_id
      && (!sinceDate || transaction.date >= sinceDate) && transaction.date <= asOfDate).sort(sortNewest);
  const selected = eligibleTargets.slice(0, limit);

  const suggestions = selected.map((transaction) => {
    const base = {
      transaction_id: transaction.id,
      payee_id: transaction.payee_id ?? null,
      date: transaction.date ?? null,
      amount_milliunits: transaction.amount ?? null,
      current_category_id: transaction.category_id ?? null,
      status: "abstained",
      proposed_edit: null,
      confidence: { level: "low", calibrated_probability: false },
    };
    const abstain = (reason, explanation, evidence = {}) => ({ ...base, reason, explanation, evidence });
    if (transaction.missing || transaction.deleted) return abstain("transaction_unavailable", "The requested transaction is missing or deleted.");
    if (transaction.category_id) return abstain("already_categorized", "The current category requires no uncategorized recommendation.");
    if (isTransfer(transaction)) return abstain("transfer", "Transfers require account review instead of expense categorization.");
    if (isSplit(transaction)) return abstain("split_requires_review", "A split requires reviewing its individual parts; no parent-category edit is proposed.");
    if (!Number.isFinite(transaction.amount) || transaction.amount >= 0) return abstain("not_an_expense", "Income, refunds, zero amounts, and invalid amounts require separate review.");
    if (!transaction.payee_id) return abstain("missing_payee_id", "An exact payee ID is required; bank names and memos cannot establish identity.");
    if (dayNumber(transaction.date) === null || transaction.date > asOfDate) return abstain("invalid_or_future_date", "The transaction must have a valid date on or before asOfDate.");

    const payeeHistory = (histories.get(transaction.payee_id) ?? []).filter((row) => row.id !== transaction.id);
    const recentSplits = payeeHistory.filter((row) => row.approved === true && !isTransfer(row)
      && row.amount < 0 && isSplit(row) && asOfDay - dayNumber(row.date) <= RECENT_DAYS);
    const reviewed = payeeHistory.filter((row) => row.approved === true && !isTransfer(row)
      && !isSplit(row) && row.amount < 0 && categories.has(row.category_id));
    const scores = new Map();
    for (const row of reviewed) {
      if (!scores.has(row.category_id)) scores.set(row.category_id, { category: categories.get(row.category_id), weight: 0, rows: [] });
      const entry = scores.get(row.category_id);
      entry.weight += 2 ** (-(asOfDay - dayNumber(row.date)) / HALF_LIFE_DAYS);
      entry.rows.push(row);
    }
    const totalWeight = [...scores.values()].reduce((sum, entry) => sum + entry.weight, 0);
    const rankedScores = [...scores.values()].sort((a, b) => b.weight - a.weight
      || a.category.id.localeCompare(b.category.id));
    const alternatives = rankedScores.map((entry) => ({
      category_id: entry.category.id,
      category_name: entry.category.name,
      category_group: entry.category.group,
      reviewed_count: entry.rows.length,
      recent_count: entry.rows.filter((row) => asOfDay - dayNumber(row.date) <= RECENT_DAYS).length,
      recency_weighted_share: totalWeight > 0 ? rounded(entry.weight / totalWeight) : 0,
      newest_date: entry.rows[0].date,
      sample_transaction_ids: entry.rows.slice(0, 5).map((row) => row.id),
    }));
    const matchedSchedules = matchSchedules(transaction, scheduledTransactions, categories);
    const scheduleCategories = [...new Set(matchedSchedules.filter((scheduled) => !isSplit(scheduled)).map((scheduled) => scheduled.category_id))];
    const evidence = {
      identity_basis: "exact_payee_id",
      reviewed_history_count: reviewed.length,
      recent_split_count: recentSplits.length,
      recency_half_life_days: HALF_LIFE_DAYS,
      alternatives: alternatives.slice(0, 3),
      matching_schedules: matchedSchedules.map((scheduled) => ({
        scheduled_transaction_id: scheduled.id,
        category_id: scheduled.category_id,
        date_next: scheduled.date_next ?? scheduled.next_date,
        amount_milliunits: scheduled.amount,
        account_id: scheduled.account_id,
      })),
      ignored_text_fields: ["memo", "import_payee_name", "import_payee_name_original", "payee_name"],
    };
    if (recentSplits.length || matchedSchedules.some(isSplit)) return abstain("payee_split_history", "Recent reviewed splits or a matching split schedule make a single category uncertain.", evidence);
    if (scheduleCategories.length > 1) return abstain("ambiguous_schedules", "Matching schedules disagree on the category.", evidence);
    const leading = alternatives[0];
    const scheduleCategory = scheduleCategories[0];
    if (scheduleCategory && leading && scheduleCategory !== leading.category_id) return abstain("schedule_history_conflict", "The matching schedule and leading reviewed history disagree.", evidence);
    const leadingShare = totalWeight > 0 ? rankedScores[0].weight / totalWeight : 0;
    if (leading && leadingShare < 0.85) return abstain("mixed_categories", "Reviewed payee history does not consistently support one category.", evidence);

    let category;
    let confidence;
    let reason;
    let explanation;
    if (leading && leading.reviewed_count >= 3 && leading.recent_count > 0) {
      category = categories.get(leading.category_id);
      confidence = { level: leading.reviewed_count >= 5 && leading.recent_count >= 3
        && leadingShare >= 0.95 ? "high" : "medium", calibrated_probability: false,
      recency_weighted_share: leading.recency_weighted_share };
      reason = scheduleCategory ? "consistent_history_and_schedule" : "consistent_reviewed_history";
      explanation = `${leading.reviewed_count} reviewed expenses support this category, weighted toward recent transactions${scheduleCategory ? "; a nearby schedule also matches the account and amount" : ""}.`;
    } else if (scheduleCategory) {
      category = categories.get(scheduleCategory);
      confidence = { level: "medium", calibrated_probability: false };
      reason = "matching_schedule";
      explanation = "A nearby schedule matches the exact payee, account, and amount; reviewed history is limited. Review this recommendation carefully.";
    } else {
      return abstain(leading && leading.recent_count === 0 ? "stale_history" : "insufficient_history",
        leading && leading.recent_count === 0 ? "All usable reviewed history is older than 180 days."
          : "At least three consistent reviewed expenses, including recent history, or a matching schedule are required.", evidence);
    }
    return { ...base, status: "suggested", reason, explanation, confidence, evidence,
      suggested_category: category,
      proposed_edit: { id: transaction.id, categoryId: category.id } };
  });

  return {
    as_of_date: asOfDate,
    inspected_count: suggestions.length,
    suggested_count: suggestions.filter((suggestion) => suggestion.status === "suggested").length,
    abstained_count: suggestions.filter((suggestion) => suggestion.status === "abstained").length,
    remaining_count: Math.max(0, eligibleTargets.length - selected.length),
    suggestions,
    proposed_edits: suggestions.filter((suggestion) => suggestion.proposed_edit).map((suggestion) => suggestion.proposed_edit),
    write_policy: {
      write_tool: "update_transactions",
      requires_exact_write_preview: true,
      requires_explicit_user_approval: true,
      automatically_applied: false,
      instruction: "Review proposed edits with the user, request an exact write preview, and obtain explicit approval before executing. A suggestion or preview token is not consent.",
    },
  };
}

/** Register through the server's normal read-only wrapper and tool catalog. */
export function registerCategorySuggestionTools({ registerTool, run, ok, api, fetchTransactions, resolveBudgetId, z, now = () => new Date() }) {
  registerTool("suggest_transaction_categories", {
    description: "Read-only, explained category recommendations for uncategorized expenses using exact payee IDs, reviewed full history, recency and matching schedules. Abstains for uncertainty and splits. Returns proposed edits; never applies them. User approval and an exact write preview are required for any later edit.",
    inputSchema: {
      budgetId: z.string().optional(),
      transactionIds: z.array(z.string().min(1)).max(100).optional().describe("Exact transaction IDs to inspect; default uncategorized transactions."),
      sinceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Target selection start date; historical evidence still covers all history."),
      asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Recommendation date YYYY-MM-DD; defaults to current UTC date."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum target transactions, default 50; history is never truncated to this limit."),
    },
  }, (input) => run(async () => {
    const budgetId = resolveBudgetId(input.budgetId);
    const requestedAt = now().toISOString();
    const [history, categoryResponse, scheduleResponse] = await Promise.all([
      fetchTransactions({ budgetId, sinceDate: HISTORY_START, freshness: "fresh" }),
      api.categories.getCategories(budgetId),
      api.scheduledTransactions.getScheduledTransactions(budgetId),
    ]);
    if (!Array.isArray(history?.transactions) || !Array.isArray(categoryResponse?.data?.category_groups)
      || !Array.isArray(scheduleResponse?.data?.scheduled_transactions)) {
      throw new Error("Category suggestions require complete transaction, category, and schedule read responses.");
    }
    const result = computeCategorySuggestions({
      transactions: history.transactions,
      categoryGroups: categoryResponse.data.category_groups,
      scheduledTransactions: scheduleResponse.data.scheduled_transactions,
      transactionIds: input.transactionIds,
      sinceDate: input.sinceDate,
      asOfDate: input.asOfDate ?? requestedAt.slice(0, 10),
      limit: input.limit ?? 50,
    });
    return ok({ budget_id: budgetId, ...result,
      freshness: { requested_at: requestedAt, fetched_at: now().toISOString(), mode: "fresh_full_read", server_knowledge: history.server_knowledge ?? null },
      history_coverage: { requested_since_date: HISTORY_START, returned_transaction_count: history.transactions.length, target_limit_does_not_limit_history: true },
    });
  }));
}
