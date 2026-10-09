# Analytics improvements

All tools in this document are read-only. They use deterministic calculations,
make no model-provider calls, and do not apply suggested changes. Tests use only
synthetic accounts, categories, schedules, and transactions.

## Coverage checklist

- [x] Positive category refunds reduce spending rather than disappearing.
- [x] Income classification uses category IDs resolved from category/group
  `internal` metadata; transaction display names are never income classifiers.
- [x] Ambiguous or older metadata fails clearly and accepts explicit
  `incomeCategoryIds` from `list_categories`. Where an adapter provides account
  payment-category ID linkage, those IDs are excluded and rejected as income.
- [x] Income reversals reduce income. Deleted rows and transfers are excluded.
- [x] Split components are counted once, with their own income/category/transfer
  identity. Inconsistent splits fail rather than produce incomplete totals.
- [x] Monetary sums use integer milliunits and retain fractional-cent amounts.
  Savings percentages are rounded to two decimals after net amounts are summed.
- [x] Uncategorized positive inflows are reported separately; they are excluded
  from income and spending until classified. Savings describes known categorized
  cashflows, so investigate these rows before treating it as a complete picture.
- [x] Monthly category/payee trends include refunds, zero-activity months, stable
  IDs, split payees, complete/partial-month labels, and prior-month comparisons.
- [x] Unusual-spending observations state the threshold and evidence and require
  at least three prior complete months. They make no fraud or causality claim.
- [x] Scheduled-payment account forecasts include income, outflows, and transfers
  once, including missing transfer counterparts and split-transfer components.
- [x] Forecasts retain calendar month-end anchors and disclose unsupported,
  ambiguous, malformed, missing-account, and overdue/today schedule limitations.
- [x] Registered-tool through mocked HTTP tests prove these tools perform GETs
  only and request explicit history dates without presentation-row caps.

## Existing behavior versus additions

| Tool | Existing coverage | Improvement/addition |
| --- | --- | --- |
| `get_income_expense_summary` | Monthly income/spending and savings | Correct category refunds, localized metadata-based identities, split/transfer handling, reversals, exact money sums, explicit classification evidence |
| `get_budget_health` | Current month health and trailing savings indicator | Uses the corrected income/spending calculation; reports classification and unknown inflows |
| `detect_recurring_charges` | Repeated equal outflows by payee and estimated annual cost | Already covered; retained without a duplicate recurrence detector |
| `review_unapproved` | New payees, novel amounts, category drift and approval review | Already covered; the new observation concerns historical monthly totals, not approval or fraud |
| `audit_account_reconciliation` | Cleared/uncleared balances and open register items | Already covered; forecast projects future scheduled account ledger changes |
| `list_scheduled_transactions` | Raw manual schedules | Already covered; forecast expands dates and computes daily balances |
| `get_spending_trends` | No existing grouped historical comparison | New category/payee net monthly totals, changes and explained observations |
| `forecast_scheduled_balances` | No existing scheduled balance projection | New future scheduled balance projection with evidence and omissions |

## Income and refunds

`get_income_expense_summary` and `get_budget_health` read category and account
metadata. If exactly one active internal category belongs to an active internal
group after excluding any adapter-provided account payment categories, its ID identifies income.
The API provides flags rather than an explicit income enum, so ambiguous metadata
requires an explicit ID; the server does not guess from English names. Native
account responses do not guarantee payment-category ID linkage. Budgets exposing
multiple internal category types therefore need an explicit income ID.

For income 1,000, ordinary spending 300 and a category refund 100, net spending is
200, net cashflow is 800 and the savings rate is 80%. A refund larger than that
month's spending can produce negative spending and a rate above 100%; this
describes recorded cashflows rather than capping or hiding the refund.

An uncategorized outflow remains spending. An uncategorized inflow is reported in
`unclassified_inflows`. A transfer is excluded even if someone gave it an income
display name. A split's parent amount is not counted again after its components.

## Spending trends and observations

`get_spending_trends` accepts `groupBy: "category" | "payee"`, inclusive dates,
and `minAnomalyIncrease` in dollars (default 50). It defaults to the six complete
calendar months preceding this month and accepts at most 36 calendar months.
The tool rejects a future end date. Completeness is bounded by today's date in
the pure helper too, so a caller's month-end bound cannot turn a current partial
month into an observation. Future-dated rows do not contribute to actual trends.
It requests the explicit history window, uses all returned rows, and inserts
zero-activity months per entity.

Net spending equals outflows minus category refunds. Inflows to the identified
income category and transfers are excluded. Stable category/payee IDs define
groups, so identical display names do not merge unrelated entities. Split
components use their payee, falling back to the parent when absent.

An observation compares the last complete month to the median of at least three
prior complete months, including zero months. The increase must be positive and
at least `max(minAnomalyIncrease, 3 * median absolute deviation,
50% * abs(baseline median))`. A partial latest month is never flagged. Results
include the baseline, threshold and increase. This is a descriptive rule, not a
probability, fraud detector, financial diagnosis or transaction-edit instruction.
Variable bills, travel, reimbursements and timing can all explain an observation.

## Scheduled balance forecasts

`forecast_scheduled_balances` accepts `horizonDays` (1–365, default 30) and an
optional open `accountId`. It reads current ledger balances and manual scheduled
transactions; it makes no transaction-history or bank request. All open accounts
are considered before filtering an account so transfer effects remain balanced.

Future dates are strictly after today. Today and overdue occurrences are excluded
because current balances may already include them; their later recurrences can
still be included. Recurrences support daily, weekly, every-other-week,
every-four-week and the API's calendar month/year intervals. Month-end schedules
clamp to February and retain the original day for March. Twice-monthly dates use
the original day and a second day 15 days later when `date_first` is on or before
the 15th. Later first days do not expose both anchors unambiguously and are
omitted with a reason. See [YNAB's schedule guide](https://support.ynab.com/en_us/scheduled-transactions-a-guide-BygrAIFA9).

Reciprocal scheduled transfer rows are paired by date, reciprocal accounts and
opposite exact amounts. Distinct equal-value transfer pairs remain separate. If
only one side exists, the counterpart is derived and labeled. Split transfers
affect the destination as well as the parent's total source-account effect.
Missing or closed destinations are explicitly cautioned.

Daily balance changes are netted before the end-of-day minimum is computed.
This is not an intraday liquidity, bank settlement, cleared-balance,
available-to-spend or category-funding forecast. Unscheduled spending, changing
bill amounts, unrecorded income, imports, interest and fees are excluded.
`complete_schedule_coverage: false` means some schedule was omitted or cautioned.
The `events` list identifies schedules and derived transfers supporting the
projection. Bank memos are not included in forecast evidence.

## Verification and provenance

Run `node --test test/analytics.test.mjs test/analytics-tools.test.mjs` for 28
offline cases covering the helper formulas and registered-tool/HTTP boundary.
The existing exported-helper regression in `test/unit.test.mjs` now passes
income IDs explicitly rather than English display names.

These additions are independently implemented. No upstream implementation code
was copied. The category/group flag and date assumptions were checked against
the repository's saved YNAB OpenAPI schema, [YNAB API changelog](https://api.ynab.com/)
and the official schedule guide. No AGPL implementation was consulted or copied.
