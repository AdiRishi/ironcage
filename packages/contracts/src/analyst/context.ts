import { Schema, Struct } from "effect";

import { ComparisonSelection, CountedScope, MonthsSelection, Scope } from "../finance/analysis.ts";
import { SpendingInput } from "../finance/flow.ts";
import { CounterpartyId } from "../finance/interpretation.ts";
import { PostingId, YearMonth } from "../finance/values.ts";

// What a question was asked about, as the screen it was asked on selects it. It names
// records and periods and never figures, which the analyst reads from the API before it
// answers.
export const AskContext = Schema.Union([
  // Spending in a category, or one counterparty's within it, as a spending row opens it,
  // narrowed like Spending to a tag or personal event.
  Schema.Struct({
    kind: Schema.Literal("category"),
    period: MonthsSelection,
    comparison: ComparisonSelection,
    ...Scope.fields,
    ...Struct.pick(SpendingInput.fields, ["tagId", "personalEventId"]),
  }),
  Schema.Struct({ kind: Schema.Literal("counterparty"), counterpartyId: CounterpartyId }),
  Schema.Struct({ kind: Schema.Literal("transaction"), postingId: PostingId }),
  // A flow stream, by the ledger facts it sums. A spending stream opens Spending against
  // the comparison, and any other stream the counted ledger.
  Schema.Struct({
    kind: Schema.Literal("stream"),
    period: MonthsSelection,
    comparison: ComparisonSelection,
    scope: CountedScope,
  }),
  Schema.Struct({ kind: Schema.Literal("briefing"), month: YearMonth }),
]).pipe(Schema.toTaggedUnion("kind"));
export type AskContext = typeof AskContext.Type;
