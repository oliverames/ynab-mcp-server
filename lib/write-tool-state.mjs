// Read-only preparation shared by preview and execution. No memo/name is code.
export async function readWriteToolState(name, input, ctx) {
  const { api, fetchTransactions, getTransaction, normalizeId, journal, buildCategoryPlan, operationRunner } = ctx;
  const args = structuredClone(input);
  delete args.previewToken;
  delete args.confirmed;
  let bid = ctx.resolveBudgetId(args.budgetId);
  if (name === 'undo_operation' || name === 'resume_operation') {
    if (!journal) throw new Error('A durable journal is required for this operation.');
    const entry = (await journal.read()).find(e => e.id === args.entryId || e.id === args.operationId);
    if (!entry) throw new Error('Journal operation was not found.');
    if (entry.tenant_id && entry.tenant_id !== ctx.tenantId) throw new Error('Journal operation belongs to another authenticated tenant.');
    if (args.budgetId && args.budgetId !== entry.budget_id) throw new Error("Journal operation belongs to a different budget.");
    if (entry.undone) throw new Error("This operation was already undone.");
    if (name === "undo_operation" && entry.undo_status) throw new Error("A previous undo may have applied or is unresolved. Inspect fresh state; automatic retry is blocked to prevent duplicate recreation or partial deletion.");
    bid = entry.budget_id;
    if (name === 'resume_operation') {
      const steps = [];
      for (const step of entry.steps) steps.push({ id: step.id, current: await ctx.readOperationStep(step, { budgetId: bid }) });
      return { input: { ...args, budgetId: bid }, before: { operation: entry, steps }, intents: entry.steps.map(s => ({ target: s.target, after: s.after })) };
    }
    const state = [];
    if (!entry.verified_after) throw new Error('This legacy or unverified undo entry has no verified after-state. Automatic restoration is unsafe.');
    for (const row of entry.verified_after) {
      let transaction;
      try { transaction = await getTransaction(bid, row.id); }
      catch (error) {
        if (entry.undo?.type !== 'recreate_transaction' || String(error?.error?.name) !== 'resource_not_found') throw error;
        transaction = { id: row.id, deleted: true };
      }
      if (!ctx.matchesAfter(row, transaction)) throw new Error(`Undo conflict: transaction ${row.id} changed since the recorded verified write. No restoration attempted.`);
      state.push(transaction);
    }
    return { input: { ...args }, before: { entry, transactions: state } };
  }
  // Resolve mutable aliases to one concrete budget, then bind that ID to token.
  if (bid === 'last-used' || bid === 'default') {
    const { data } = await api.plans.getPlans(false);
    const candidate = data.default_plan || data.default_budget;
    if (!candidate?.id) throw new Error('Cannot resolve the default budget for an exact preview. Pass an explicit budgetId.');
    bid = candidate.id;
  }
  args.budgetId = bid;
  if (['merge_category','retire_category','move_category_budget'].includes(name)) {
    const operation = await buildCategoryPlan(name, args);
    return { input: args, before: operation.steps.map(s => ({ id: s.id, target: s.target, before: s.before })), intents: operation.steps.map(s => ({ id: s.id, target: s.target, after: s.after })), operation };
  }
  if (name === 'import_transactions') throw new Error('YNAB does not expose pending bank-import IDs and values before import. An exact write preview cannot be issued; import in YNAB, then review the imported rows here.');
  const before = {};
  if (['update_transaction','delete_transaction','prepare_split_for_matching'].includes(name)) {
    before.transactions = [await getTransaction(bid, args.transactionId)];
  } else if (name === 'update_transactions') {
    if (args.transactions.some(t => (t.id !== undefined) === (t.importId !== undefined))) throw new Error('Each transaction update must provide exactly one of id or importId.');
    if (args.transactions.some(t => t.importId !== undefined)) {
      const all = (await fetchTransactions({ budgetId: bid, sinceDate: '1970-01-01', freshness: 'fresh' })).transactions.filter(t => !t.deleted);
      args.transactions = args.transactions.map(t => {
        if (t.id !== undefined) return t;
        const matches = all.filter(row => row.import_id === t.importId && (!t.accountId || row.account_id === t.accountId));
        if (matches.length !== 1) throw new Error(`Import ID ${t.importId} must match exactly one transaction before preview; use its transaction ID.`);
        const { importId, ...fields } = t;
        return { ...fields, id: matches[0].id };
      });
    }
    const ids = args.transactions.map(t => normalizeId(t.id));
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate transaction IDs in one write are unsafe.');
    const byId = await ctx.getTransactionsByIds(bid, ids);
    before.transactions = ids.map(id => { if (!byId.has(id)) throw new Error(`Transaction ${id} was not found in fresh state.`); return byId.get(id); });
  } else if (['approve_transactions','reassign_payee_transactions'].includes(name)) {
    let rows = (await fetchTransactions({budgetId:bid,sinceDate:args.sinceDate || '1970-01-01',untilDate:args.untilDate,freshness:'fresh'})).transactions.filter(t => !t.deleted);
    if (name === 'approve_transactions') {
      rows = rows.filter(t => !t.approved && (!args.payeeId || t.payee_id === args.payeeId) && (!args.categoryId || t.category_id === args.categoryId) && (!args.accountId || t.account_id === args.accountId) && (args.includeUncategorized || t.category_id || t.transfer_account_id));
    } else rows = rows.filter(t => t.payee_id === args.fromPayeeId);
    before.transactions = rows.sort((a,b)=>a.id.localeCompare(b.id));
  } else if (name === 'update_month_category') {
    before.category = (await api.categories.getMonthCategoryById(bid,args.month,args.categoryId)).data.category;
  } else if (['update_category','create_category','create_category_group','update_category_group'].includes(name)) {
    before.category_groups = (await api.categories.getCategories(bid)).data.category_groups;
  } else if (['update_payee','create_payee'].includes(name)) {
    before.payees = (await api.payees.getPayees(bid)).data.payees;
  } else if (['update_scheduled_transaction','delete_scheduled_transaction'].includes(name)) {
    before.scheduled_transaction = (await api.scheduledTransactions.getScheduledTransactionById(bid,args.scheduledTransactionId)).data.scheduled_transaction;
  } else if (['create_transaction','create_transactions','create_scheduled_transaction','create_account'].includes(name)) {
    before.accounts = (await api.accounts.getAccounts(bid)).data.accounts;
  } else throw new Error(`Exact preview preparation is unavailable for ${name}.`);
  const transactionInputs = name === 'create_transactions' || name === 'update_transactions' ? args.transactions : ['create_transaction','update_transaction','prepare_split_for_matching'].includes(name) ? [args] : [];
  for (const row of transactionInputs) {
    if (!row.subtransactions) continue;
    const current = before.transactions?.find(t => normalizeId(t.id) === normalizeId(row.id || row.transactionId || ''));
    if (current?.subtransactions?.some(s => !s.deleted) && name !== 'prepare_split_for_matching') throw new Error('Existing split structure cannot be updated through YNAB; change it in the YNAB register.');
    const amount = row.amount ?? current?.amount;
    if (!Number.isFinite(amount) || !row.subtransactions.length || row.subtransactions.reduce((sum,s) => sum + Math.round(s.amount * 1000),0) !== Math.round(amount * 1000)) throw new Error('Split line amounts must exactly sum to the transaction total.');
  }
  // Include existing split lines, imported linkage, transfer references and
  // approved/cleared state in the fingerprint. Creation IDs cannot exist yet;
  // its complete submitted payload and destination account are bound instead.
  return { input: args, before };
}
