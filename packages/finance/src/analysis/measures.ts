import type {
  CategoryId,
  CategoryScope,
  FactMeasure,
  FlowDirection,
  LedgerMeasure,
  PartSign,
} from "@repo/contracts/finance";

export type CountedFact = Exclude<FactMeasure, "internal">;

// Which way a fact's money moved. Counted amounts are signed this way, as the bank books
// them: money out is negative.
export const factDirection = {
  spending: "out",
  externalOut: "out",
  loanRepayment: "out",
  unresolvedOut: "out",
  income: "in",
  borrowing: "in",
  externalIn: "in",
  unresolvedIn: "in",
} as const satisfies Record<CountedFact, FlowDirection>;

// The facts of one kind that make up part of a measure, optionally only those on loan
// accounts.
export type MeasurePart = {
  readonly fact: CountedFact;
  readonly sign: PartSign;
  readonly loanAccounts: boolean;
  readonly label: string;
};
type MeasureDefinition = {
  readonly label: string;
  readonly parts: readonly [MeasurePart, ...MeasurePart[]];
};

const whole = (label: string, fact: CountedFact): MeasureDefinition => ({
  label,
  parts: [{ fact, sign: "add", loanAccounts: false, label }],
});

// Every number the flow draws, as ledger facts. The flow sums them and the counted ledger
// lists their postings, so a stream and the records behind it cannot disagree.
export const measures = {
  spending: whole("Spending", "spending"),
  income: whole("Income", "income"),
  borrowing: whole("Borrowed", "borrowing"),
  externalIn: whole("From your other accounts", "externalIn"),
  externalOut: whole("To your other accounts", "externalOut"),
  unresolvedIn: whole("Not yet understood, incoming", "unresolvedIn"),
  unresolvedOut: whole("Not yet understood, outgoing", "unresolvedOut"),
  loanPrincipal: {
    label: "Loan principal",
    parts: [
      { fact: "loanRepayment", sign: "add", loanAccounts: false, label: "Repayments" },
      {
        fact: "spending",
        sign: "less",
        loanAccounts: true,
        label: "Interest and fees on your loans",
      },
    ],
  },
} satisfies Record<LedgerMeasure, MeasureDefinition>;

export const uncategorisedLabel = "Not yet categorised";
// What sits on a category itself, without its subcategories.
export const unspecifiedLabel = (categoryName: string) => `${categoryName}, unspecified`;
// Facts whose event has no counterparty.
export const unidentifiedLabel = "Unidentified";

// A measure's amount from the sum of each of its parts. Repayments include the interest
// already counted as spending on the loan, so a period where interest posts before the
// repayment shows no principal rather than a negative one.
export function measureTotal(
  measure: LedgerMeasure,
  partTotal: (part: MeasurePart, index: number) => bigint,
) {
  const total = measures[measure].parts.reduce((sum, part, index) => {
    const amount = partTotal(part, index);
    return part.sign === "add" ? sum + amount : sum - amount;
  }, 0n);
  return measure === "loanPrincipal" && total < 0n ? 0n : total;
}

// Whether a fact placed on `categoryId` falls in the scope. `parents` maps every
// category to its parent.
export function inCategoryScope(
  scope: CategoryScope,
  categoryId: typeof CategoryId.Type | null,
  parents: ReadonlyMap<typeof CategoryId.Type, typeof CategoryId.Type | null>,
) {
  switch (scope.kind) {
    case "all":
      return true;
    case "uncategorised":
      return categoryId === null;
    case "unspecified":
      return categoryId === scope.id;
    case "category":
      for (let at = categoryId; at; at = parents.get(at) ?? null) if (at === scope.id) return true;
      return false;
  }
}
