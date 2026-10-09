// Independently implemented deterministic analytics. Inputs use YNAB integer
// milliunits. Free-form payee/category text is evidence, never instructions.
const DAY = 86400000;
const money = (amount) => amount / 1000;
const pct = (amount) => Math.round(amount * 100) / 100;

export function parseAnalyticsDate(value, field = "date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD.`);
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error(`${field} is not a valid calendar date.`);
  return time;
}

function integerAmount(value) {
  if (!Number.isSafeInteger(value)) throw new Error("Analytics require safe integer YNAB milliunit amounts.");
  return value;
}

function addAmount(a, b) {
  return integerAmount(a + integerAmount(b));
}

// Resolve the identity once from category metadata, not transaction display
// names. Payment categories belong to accounts and cannot be income. Older or
// ambiguous metadata needs an explicit ID rather than an English-name guess.
export function resolveIncomeCategoryIds(categoryGroups = [], { incomeCategoryIds, accounts = [] } = {}) {
  const known = new Map(categoryGroups.flatMap((g) => (g.categories || []).map((c) => [c.id, { ...c, group: g }])));
  // Some adapters supply this linkage; native API responses do not guarantee
  // it. Ambiguous native internal categories still require explicit income IDs.
  const paymentIds = new Set(accounts.map((a) => a.credit_card_payment_category_id).filter(Boolean));
  if (incomeCategoryIds !== undefined) {
    const ids = [...new Set(incomeCategoryIds)];
    if (!ids.length) throw new Error("incomeCategoryIds must identify at least one income category.");
    for (const id of ids) {
      const category = known.get(id);
      if (!category || category.deleted || category.group.deleted || paymentIds.has(id)) throw new Error(`Income category ID ${id} is missing, deleted, or a credit-card payment category.`);
    }
    return { ids, source: "explicit_category_ids" };
  }
  const candidates = [...known.values()].filter((c) => c.internal === true && c.group.internal === true && !c.deleted && !c.group.deleted && !paymentIds.has(c.id));
  if (candidates.length !== 1) {
    throw new Error("Income category metadata is ambiguous or unavailable. Supply incomeCategoryIds from list_categories; category display names are not used to guess income.");
  }
  return { ids: [candidates[0].id], source: "internal_category_and_group_identity" };
}

export function transactionComponents(transactions) {
  const components = [];
  for (const transaction of transactions) {
    if (transaction.deleted) continue;
    parseAnalyticsDate(transaction.date, "transaction date");
    integerAmount(transaction.amount);
    const children = transaction.subtransactions || [];
    if (children.length) {
      const live = children.filter((s) => !s.deleted);
      const sum = live.reduce((total, s) => addAmount(total, s.amount), 0);
      if (sum !== transaction.amount) throw new Error(`Split ${transaction.id || "(unknown)"} does not match its live subtransaction total; analytics would be incomplete.`);
      for (const child of live) {
        components.push({ ...transaction, ...child, date: transaction.date, account_id: transaction.account_id,
          parent_transaction_id: transaction.id, payee_id: child.payee_id ?? transaction.payee_id,
          payee_name: child.payee_name ?? transaction.payee_name, transfer_account_id: child.transfer_account_id ?? null,
          subtransactions: undefined });
      }
    } else {
      components.push(transaction);
    }
  }
  return components;
}

export function summarizeIncomeExpenseMilliunits(transactions, { incomeCategoryIds = [], sinceDate, untilDate } = {}) {
  const incomeIds = new Set(incomeCategoryIds);
  const byMonth = new Map();
  let unknownInflows = 0;
  for (const t of transactionComponents(transactions)) {
    if (t.transfer_account_id || (sinceDate && t.date < sinceDate) || (untilDate && t.date > untilDate)) continue;
    const month = t.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, { income: 0, spending: 0 });
    const bucket = byMonth.get(month);
    if (incomeIds.has(t.category_id)) bucket.income = addAmount(bucket.income, t.amount);
    else if (t.amount < 0 || t.category_id) bucket.spending = addAmount(bucket.spending, -t.amount);
    else unknownInflows = addAmount(unknownInflows, t.amount);
  }
  const format = ({ income, spending }) => ({ income: money(income), spending: money(spending), net: money(integerAmount(income - spending)),
    savings_rate_pct: income > 0 ? pct(((income - spending) / income) * 100) : null });
  const totals = [...byMonth.values()].reduce((acc, m) => ({ income: addAmount(acc.income, m.income), spending: addAmount(acc.spending, m.spending) }), { income: 0, spending: 0 });
  return { months: [...byMonth.entries()].sort().map(([month, amounts]) => ({ month, ...format(amounts) })),
    totals: format(totals), unclassified_inflows: money(unknownInflows) };
}

function monthSequence(sinceDate, untilDate) {
  parseAnalyticsDate(sinceDate, "sinceDate");
  parseAnalyticsDate(untilDate, "untilDate");
  if (sinceDate > untilDate) throw new Error("sinceDate must not be after untilDate.");
  const months = [];
  let cursor = `${sinceDate.slice(0, 7)}-01`;
  while (cursor <= untilDate) {
    months.push(cursor.slice(0, 7));
    if (months.length > 36) throw new Error("Spending trends support at most 36 calendar months per request.");
    const date = new Date(`${cursor}T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + 1);
    cursor = date.toISOString().slice(0, 10);
  }
  return months;
}

function monthEnd(month) {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const half = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[half] : (ordered[half - 1] + ordered[half]) / 2;
}

export function spendingTrends(transactions, { incomeCategoryIds = [], groupBy = "category", sinceDate, untilDate, minAnomalyDelta = 50000, asOfDate = new Date().toISOString().slice(0, 10) } = {}) {
  if (!["category", "payee"].includes(groupBy)) throw new Error("groupBy must be category or payee.");
  integerAmount(minAnomalyDelta);
  if (minAnomalyDelta < 0) throw new Error("minAnomalyDelta must be nonnegative.");
  const months = monthSequence(sinceDate, untilDate);
  parseAnalyticsDate(asOfDate, "asOfDate");
  const completenessEnd = untilDate < asOfDate ? untilDate : asOfDate;
  const complete = new Set(months.filter((month) => sinceDate <= `${month}-01` && completenessEnd >= monthEnd(month)));
  const incomeIds = new Set(incomeCategoryIds);
  const groups = new Map();
  for (const t of transactionComponents(transactions)) {
    if (t.transfer_account_id || incomeIds.has(t.category_id) || t.date < sinceDate || t.date > completenessEnd || (!t.category_id && t.amount >= 0)) continue;
    const id = groupBy === "category" ? t.category_id ?? null : t.payee_id ?? null;
    // Names are a last resort only for missing payee IDs, not an instruction or
    // a merchant classifier. Distinct real IDs with the same name stay separate.
    const fallback = groupBy === "payee" && !id ? t.payee_name || "Unknown payee" : "Uncategorized";
    const key = id || `missing:${fallback}`;
    if (!groups.has(key)) groups.set(key, { id, name: groupBy === "category" ? t.category_name ?? "Uncategorized" : t.payee_name ?? "Unknown payee", buckets: new Map() });
    const group = groups.get(key);
    if (!group.buckets.has(t.date.slice(0, 7))) group.buckets.set(t.date.slice(0, 7), { outflow: 0, refunds: 0, count: 0 });
    const bucket = group.buckets.get(t.date.slice(0, 7));
    bucket.outflow = addAmount(bucket.outflow, Math.max(0, -t.amount));
    bucket.refunds = addAmount(bucket.refunds, Math.max(0, t.amount));
    bucket.count += 1;
  }
  const observations = [];
  const entities = [...groups.values()].map((g) => {
    const amounts = months.map((month) => { const b = g.buckets.get(month) || { outflow: 0, refunds: 0, count: 0 }; return { month, ...b, net: b.outflow - b.refunds }; });
    const last = amounts.at(-1);
    const previous = amounts.at(-2);
    const prior = amounts.slice(0, -1).filter((a) => complete.has(a.month));
    if (complete.has(last.month) && prior.length >= 3) {
      const baseline = median(prior.map((a) => a.net));
      const mad = median(prior.map((a) => Math.abs(a.net - baseline)));
      const change = last.net - baseline;
      const threshold = Math.max(minAnomalyDelta, 3 * mad, Math.abs(baseline) * 0.5);
      if (change > 0 && change >= threshold) observations.push({ entity_id: g.id, entity_name: g.name, month: last.month,
        label: "unusual_spending_observation", net_spending: money(last.net), baseline_median: money(baseline),
        increase: money(change), threshold: money(threshold), prior_complete_months: prior.length,
        evidence: "Latest complete month's net spending exceeds the prior complete-month median by the stated threshold. This is a descriptive signal, not fraud detection or a recommendation to change transactions." });
    }
    return { id: g.id, name: g.name, monthly: amounts.map((a) => ({ month: a.month, complete_month: complete.has(a.month), outflow: money(a.outflow), refunds: money(a.refunds), net_spending: money(a.net), transaction_components: a.count })),
      total_net_spending: money(amounts.reduce((sum, a) => addAmount(sum, a.net), 0)),
      latest_change: previous ? { from_month: previous.month, to_month: last.month, amount: money(last.net - previous.net), percent: previous.net > 0 ? pct((last.net - previous.net) / previous.net * 100) : null, comparable_complete_months: complete.has(last.month) && complete.has(previous.month) } : null };
  }).sort((a, b) => b.total_net_spending - a.total_net_spending || String(a.id ?? a.name).localeCompare(String(b.id ?? b.name)));
  return { group_by: groupBy, window: { since: sinceDate, until: untilDate, as_of_date: asOfDate, complete_months: [...complete], partial_months: months.filter((m) => !complete.has(m)) },
    entities, observations, anomaly_method: "At least 3 prior complete months, including zero-activity months. Threshold: max(minimum increase, 3 median absolute deviations, 50% of the absolute baseline median). Latest partial months are never flagged.", writes_performed: 0 };
}

const DAY_FREQUENCIES = { daily: 1, weekly: 7, everyOtherWeek: 14, every4Weeks: 28 };
const MONTH_FREQUENCIES = { monthly: 1, everyOtherMonth: 2, every3Months: 3, every4Months: 4, twiceAYear: 6, yearly: 12, everyOtherYear: 24 };

function calendarMonthDate(year, monthIndex, day) {
  return Date.UTC(year, monthIndex, Math.min(day, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()));
}

export function scheduledOccurrenceDates(scheduled, asOfDate, throughDate) {
  const start = parseAnalyticsDate(asOfDate, "asOfDate");
  const end = parseAnalyticsDate(throughDate, "throughDate");
  const first = new Date(parseAnalyticsDate(scheduled.date_first, "scheduled date_first"));
  const next = parseAnalyticsDate(scheduled.date_next, "scheduled date_next");
  if (end < start || (end - start) / DAY > 366) throw new Error("Forecast window must be between 0 and 366 days.");
  const dates = [];
  const add = (time) => { if (time > start && time >= next && time <= end) dates.push(new Date(time).toISOString().slice(0, 10)); };
  if (scheduled.frequency === "never") add(next);
  else if (DAY_FREQUENCIES[scheduled.frequency]) {
    const step = DAY_FREQUENCIES[scheduled.frequency] * DAY;
    let cursor = next;
    if (cursor <= start) cursor += (Math.floor((start - cursor) / step) + 1) * step;
    for (; cursor <= end; cursor += step) add(cursor);
  } else if (MONTH_FREQUENCIES[scheduled.frequency]) {
    const step = MONTH_FREQUENCIES[scheduled.frequency];
    const nextDate = new Date(next);
    let monthIndex = nextDate.getUTCFullYear() * 12 + nextDate.getUTCMonth();
    for (let count = 0; count < 380; count += 1, monthIndex += step) {
      // date_next is authoritative for the first occurrence; original day is
      // retained for subsequent months so February clamping does not drift.
      const time = count === 0 ? next : calendarMonthDate(Math.floor(monthIndex / 12), monthIndex % 12, first.getUTCDate());
      if (time > end) break;
      add(time);
    }
  } else if (scheduled.frequency === "twiceAMonth") {
    // YNAB's documented cadence is two month-anchored days, 15 days apart.
    // The API does not expose both anchors. First days 1..15 identify them
    // without guessing; other start days are explicitly omitted.
    if (first.getUTCDate() > 15) throw new Error("twiceAMonth with date_first after the 15th has ambiguous anchors; verify dates in YNAB.");
    add(next); // The API's first next date remains authoritative.
    let monthIndex = new Date(Math.max(start, next)).getUTCFullYear() * 12 + new Date(Math.max(start, next)).getUTCMonth();
    for (let count = 0; count < 14; count += 1, monthIndex += 1) {
      const one = calendarMonthDate(Math.floor(monthIndex / 12), monthIndex % 12, first.getUTCDate());
      if (one > end) break;
      add(one); add(calendarMonthDate(Math.floor(monthIndex / 12), monthIndex % 12, first.getUTCDate() + 15));
    }
  } else throw new Error(`Unsupported scheduled frequency: ${scheduled.frequency}.`);
  return [...new Set(dates)].sort();
}

export function forecastScheduledBalances(accounts, scheduledTransactions, { asOfDate, horizonDays = 30, accountId } = {}) {
  const start = parseAnalyticsDate(asOfDate, "asOfDate");
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 365) throw new Error("horizonDays must be between 1 and 365.");
  const throughDate = new Date(start + horizonDays * DAY).toISOString().slice(0, 10);
  const accountMap = new Map(accounts.filter((a) => !a.deleted && !a.closed).map((a) => [a.id, a]));
  if (accountId && !accountMap.has(accountId)) throw new Error(`No open account with id ${accountId}.`);
  const events = [];
  const transferLegs = [];
  const omitted = [];
  for (const scheduled of scheduledTransactions) {
    if (scheduled.deleted) continue;
    try {
      if (!accountMap.has(scheduled.account_id)) throw new Error("Source account is closed, deleted, or unavailable.");
      integerAmount(scheduled.amount);
      const dates = scheduledOccurrenceDates(scheduled, asOfDate, throughDate);
      if (scheduled.date_next <= asOfDate) omitted.push({ scheduled_transaction_id: scheduled.id, reason: "The current/overdue occurrence is excluded because current ledger balances may already include it; later recurrences are included." });
      const split = scheduled.subtransactions?.length ? scheduled.subtransactions.filter((s) => !s.deleted) : null;
      if (split && split.reduce((sum, s) => addAmount(sum, s.amount), 0) !== scheduled.amount) throw new Error("Scheduled split does not match its live subtransaction total.");
      for (const date of dates) {
        events.push({ date, account_id: scheduled.account_id, scheduled_transaction_id: scheduled.id, payee_name: scheduled.payee_name ?? null, amount: scheduled.amount, derived_transfer: false });
        for (const leg of split || [scheduled]) {
          if (leg.transfer_account_id) transferLegs.push({ date, account_id: scheduled.account_id, transfer_account_id: leg.transfer_account_id, amount: integerAmount(leg.amount), scheduled_transaction_id: scheduled.id });
        }
      }
    } catch (error) {
      omitted.push({ scheduled_transaction_id: scheduled.id, reason: error.message });
    }
  }
  const paired = new Set();
  for (let index = 0; index < transferLegs.length; index += 1) {
    if (paired.has(index)) continue;
    const leg = transferLegs[index];
    const other = transferLegs.findIndex((candidate, candidateIndex) => candidateIndex > index && !paired.has(candidateIndex)
      && candidate.date === leg.date && candidate.account_id === leg.transfer_account_id
      && candidate.transfer_account_id === leg.account_id && candidate.amount === -leg.amount);
    if (other >= 0) { paired.add(index); paired.add(other); continue; }
    if (!accountMap.has(leg.transfer_account_id)) { omitted.push({ scheduled_transaction_id: leg.scheduled_transaction_id, reason: "Transfer destination is closed, deleted, or unavailable; only the source-account effect is included." }); continue; }
    events.push({ date: leg.date, account_id: leg.transfer_account_id, scheduled_transaction_id: leg.scheduled_transaction_id, payee_name: null, amount: -leg.amount, derived_transfer: true });
  }
  const forecasts = [...accountMap.values()].filter((a) => !accountId || a.id === accountId).map((account) => {
    let balance = integerAmount(account.balance);
    let minimum = balance;
    let minimumDate = asOfDate;
    const byDate = new Map();
    const accountEvents = events.filter((e) => e.account_id === account.id).sort((a, b) => a.date.localeCompare(b.date) || a.scheduled_transaction_id.localeCompare(b.scheduled_transaction_id));
    for (const event of accountEvents) byDate.set(event.date, addAmount(byDate.get(event.date) || 0, event.amount));
    const daily = [...byDate].sort().map(([date, change]) => {
      balance = addAmount(balance, change);
      if (balance < minimum) { minimum = balance; minimumDate = date; }
      return { date, scheduled_change: money(change), projected_end_of_day_balance: money(balance) };
    });
    return { account_id: account.id, account_name: account.name, starting_ledger_balance: money(account.balance), projected_ending_balance: money(balance),
      minimum_end_of_day_balance: money(minimum), minimum_date: minimumDate, projected_negative_balance: minimum < 0,
      daily, events: accountEvents.map((e) => ({ ...e, amount: money(e.amount) })) };
  });
  return { as_of_date: asOfDate, through_date: throughDate, basis: "Current ledger balances plus future scheduled entries only; end-of-day projection, not available-to-spend or bank settlement timing.",
    assumptions: ["Amounts remain unchanged and scheduled entries occur on their scheduled dates.", "Unscheduled spending, unrecorded income, future imports, interest and fees are excluded.", "Today and overdue occurrences are excluded to avoid double counting current balances. Transfer counterparts are included once, deriving a destination effect only when no reciprocal scheduled row exists."],
    accounts: forecasts, omitted_or_cautioned: omitted, complete_schedule_coverage: omitted.length === 0, writes_performed: 0 };
}
