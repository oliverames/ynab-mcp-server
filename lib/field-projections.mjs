const FIELDS = {
  transactions: ["id", "date", "amount", "account_id", "account_name", "payee_id", "payee_name", "category_id", "category_name", "cleared", "approved", "flag_color", "transfer_account_id", "transfer_transaction_id", "matched_transaction_id", "deleted"],
  subtransactions: ["id", "transaction_id", "amount", "payee_id", "payee_name", "category_id", "category_name", "transfer_account_id", "transfer_transaction_id", "deleted"],
  accounts: ["id", "name", "type", "on_budget", "closed", "balance", "cleared_balance", "uncleared_balance", "transfer_payee_id", "deleted"],
  categories: ["id", "name", "category_group_id", "hidden", "internal", "budgeted", "activity", "balance", "deleted"],
  category_groups: ["id", "name", "hidden", "internal", "deleted"],
  payees: ["id", "name", "transfer_account_id", "deleted"],
  scheduled_transactions: ["id", "date_first", "date_next", "frequency", "amount", "account_id", "account_name", "payee_id", "payee_name", "category_id", "category_name", "transfer_account_id", "deleted"],
};

// Projection is output-only. Matching, previews and analytics retain the full
// raw rows; lean responses keep IDs, financial values and conflict/link flags.
export function projectFields(row, resource, projection = "full") {
  if (projection === "full") return row;
  if (projection !== "lean") throw new Error("projection must be lean or full");
  const fields = FIELDS[resource];
  if (!fields) throw new Error(`Unknown projection resource ${resource}`);
  const output = {};
  for (const field of fields) if (field in row) output[field] = row[field];
  if (row.subtransactions) output.subtransactions = row.subtransactions.map((item) => projectFields(item, "subtransactions", projection));
  if (row.categories) output.categories = row.categories.map((item) => projectFields(item, "categories", projection));
  return output;
}

export function projectCollection(rows, resource, projection = "full") {
  return rows.map((row) => projectFields(row, resource, projection));
}
