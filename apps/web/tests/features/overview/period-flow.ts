import {
  CalendarDate,
  CategoryId,
  type CountedScope,
  type FlowStream,
  type PeriodFlow,
} from "@repo/contracts/finance";

const money = (minor: bigint) => ({ currency: "AUD", minor });
const period = (start: string, endExclusive: string) => ({
  start: CalendarDate.make(start),
  endExclusive: CalendarDate.make(endExclusive),
});
const figures = (scope: CountedScope, minor: bigint) => ({
  scope,
  amount: money(minor),
  previous: money(0n),
  modelAmount: money(0n),
});
const all = { kind: "all" } as const;

export const salary = CategoryId.make("00000000-0000-4000-8000-000000000163");
export const housing = CategoryId.make("00000000-0000-4000-8000-000000000101");
export const food = CategoryId.make("00000000-0000-4000-8000-000000000102");
export const travel = CategoryId.make("00000000-0000-4000-8000-000000000108");

const category = (
  id: typeof CategoryId.Type,
  slug: string,
  label: string,
  minor: bigint,
): FlowStream => ({
  kind: "category",
  key: `category:${id}`,
  categoryId: id,
  slug,
  label,
  ...figures({ measure: "spending", category: { kind: "category", id }, counterparty: all }, minor),
});

// August 2026: $8,500 of salary and $500 from savings elsewhere came in. Rent, food, loan
// principal, and $2,000 to savings went out, and a $300 travel refund arrived with no
// travel spending, so Travel is $300 net money back. The headline leaves $3,740 over:
// $9,000 in less $5,260 out.
export const august: PeriodFlow = {
  period: period("2026-08-01", "2026-09-01"),
  comparison: period("2026-07-01", "2026-08-01"),
  basis: "spending",
  currency: "AUD",
  calculatedAt: "2026-09-25T00:00:00.000Z",
  totals: {
    inflow: money(900000n),
    outflow: money(526000n),
    spending: money(216000n),
    income: money(850000n),
    internal: money(0n),
  },
  previousTotals: {
    inflow: money(0n),
    outflow: money(0n),
    spending: money(0n),
    income: money(0n),
    internal: money(0n),
  },
  inflows: [
    {
      kind: "income",
      key: `income:${salary}`,
      label: "Salary",
      ...figures(
        { measure: "income", category: { kind: "category", id: salary }, counterparty: all },
        850000n,
      ),
    },
    {
      kind: "externalIn",
      key: "externalIn",
      label: "From your other accounts",
      ...figures({ measure: "externalIn", category: all, counterparty: all }, 50000n),
    },
  ],
  outflows: [
    category(housing, "housing", "Housing", 184000n),
    category(food, "food", "Food", 62000n),
    category(travel, "travel", "Travel", -30000n),
    {
      kind: "loanPrincipal",
      key: "loanPrincipal",
      label: "Loan principal",
      ...figures({ measure: "loanPrincipal", category: all, counterparty: all }, 110000n),
    },
    {
      kind: "externalOut",
      key: "externalOut",
      label: "To your other accounts",
      ...figures({ measure: "externalOut", category: all, counterparty: all }, 200000n),
    },
  ],
  modelShare: money(0n),
  changes: [],
  coverage: [],
  comparisonCoverage: { state: "complete", gaps: [] },
};
