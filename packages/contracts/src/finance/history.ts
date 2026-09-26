import { Schema } from "effect";

import { Correction } from "./corrections.ts";
import { CounterpartyChangeEntry } from "./counterparty-history.ts";
import { CounterpartyId } from "./interpretation.ts";

// A change that set something on one event: a correction of the event itself, or a
// counterparty change that altered what the event means.
export const EventHistoryEntry = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("correction"), correction: Correction }),
  Schema.Struct({ kind: Schema.Literal("counterparty"), change: CounterpartyChangeEntry }),
]).pipe(Schema.toTaggedUnion("kind"));
// Entries newest first. `names` names every counterparty the corrections refer to,
// including ones a merge has since removed. A counterparty change names its own in
// `subjects`.
export const EventHistory = Schema.Struct({
  entries: Schema.Array(EventHistoryEntry),
  names: Schema.Array(Schema.Struct({ id: CounterpartyId, name: Schema.String })),
});
