import { Schema, Struct } from "effect";

import {
  ComparisonSelection,
  CountedScope,
  DateBasis,
  FlowDirection,
  MonthsSelection,
} from "../finance/analysis.ts";
import { ListCounterparties } from "../finance/counterparties.ts";
import { SpendingInput } from "../finance/flow.ts";
import { CounterpartyId } from "../finance/interpretation.ts";
import { CountedFilter, PostingFilter } from "../finance/postings.ts";
import { Instant, Money, PostingId } from "../finance/values.ts";

// An answer names a figure as `[[f1]]` and a record as `[[r1]]`.
export const FigureId = Schema.String.check(Schema.isPattern(/^f[1-9]\d*$/)).pipe(
  Schema.brand("FigureId"),
);
export type FigureId = typeof FigureId.Type;
export const RecordId = Schema.String.check(Schema.isPattern(/^r[1-9]\d*$/)).pipe(
  Schema.brand("RecordId"),
);
export type RecordId = typeof RecordId.Type;

// The screen that shows a figure's number or a record. Screens read whole months, on
// spending dates, in the reporting currency, so links name months and leave the rest to
// the screen.
export const RecordLink = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("overview"),
    period: MonthsSelection,
    comparison: ComparisonSelection,
  }),
  Schema.Struct({
    kind: Schema.Literal("spending"),
    period: MonthsSelection,
    ...Struct.omit(SpendingInput.fields, ["period", "basis", "currency"]),
  }),
  // The records a measure counts, narrowed like the ledger narrows them.
  Schema.Struct({
    kind: Schema.Literal("countedLedger"),
    scope: CountedScope,
    period: MonthsSelection,
    filter: CountedFilter,
  }),
  // Postings over whole months, which set the first and last days, narrowed by the
  // ledger's other filters.
  Schema.Struct({
    kind: Schema.Literal("postingLedger"),
    period: MonthsSelection,
    filter: Schema.Struct(Struct.omit(PostingFilter.fields, ["from", "to"])),
  }),
  Schema.Struct({ kind: Schema.Literal("transaction"), postingId: PostingId }),
  // The counterparties money went to or came from, as the list shows them.
  Schema.Struct({
    kind: Schema.Literal("counterparties"),
    period: MonthsSelection,
    direction: FlowDirection,
    search: ListCounterparties.fields.search,
  }),
  Schema.Struct({ kind: Schema.Literal("counterparty"), counterpartyId: CounterpartyId }),
  // Without a period, every open question.
  Schema.Struct({ kind: Schema.Literal("questions"), period: Schema.NullOr(MonthsSelection) }),
  Schema.Struct({ kind: Schema.Literal("sources") }),
]).pipe(Schema.toTaggedUnion("kind"));
export type RecordLink = typeof RecordLink.Type;

export const CountUnit = Schema.Literals(["purchase", "transaction", "question"]);
export const FigureValue = Schema.Union([
  // `signed` shows the sign of a change, as +$310.
  Schema.Struct({ kind: Schema.Literal("money"), amount: Money, signed: Schema.Boolean }),
  // Shown with its unit, as 3 purchases.
  Schema.Struct({
    kind: Schema.Literal("count"),
    count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    unit: CountUnit,
  }),
  // A whole percent, rounded as the screens round it. `signed` shows the sign of a
  // change, as +76%, where a share has none.
  Schema.Struct({ kind: Schema.Literal("percent"), percent: Schema.Int, signed: Schema.Boolean }),
]).pipe(Schema.toTaggedUnion("kind"));
export type FigureValue = typeof FigureValue.Type;

// A number an answer quotes. Code reads and computes it, and the model only places it.
// `basis` is null for a figure no period places, such as one transaction's amount, and
// `modelAmount`, how much of it rests on the model's reading of transactions, is null
// where the model reads nothing, such as a count of questions.
export const Figure = Schema.Struct({
  id: FigureId,
  label: Schema.String,
  value: FigureValue,
  basis: Schema.NullOr(DateBasis),
  calculatedAt: Instant,
  modelAmount: Schema.NullOr(Money),
  records: RecordLink,
});
export type Figure = typeof Figure.Type;

// A transaction, counterparty, or list an answer names, such as "Dinner at Rockpool".
export const RecordRef = Schema.Struct({
  id: RecordId,
  label: Schema.String,
  records: RecordLink,
});
export type RecordRef = typeof RecordRef.Type;
