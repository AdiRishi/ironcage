import { Schema, Struct } from "effect";

import {
  AssignmentAuthor,
  AssignmentStatus,
  Counterparty,
  CounterpartyChange,
  CounterpartyChangePreview,
} from "./counterparties.ts";
import { FinancialEvent } from "./events.ts";
import { CategoryId, CounterpartyId, CounterpartyRole, EventId } from "./interpretation.ts";
import { RuleId } from "./rules.ts";
import { CommandId, Instant, RecordCursor, Version } from "./values.ts";

export const CounterpartyChangeId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("CounterpartyChangeId"),
);
// Each `CounterpartyChange` kind, and two that history records without one:
// `acceptCategory` moves the model's counterparties into a subcategory you accepted, and
// `undo` reverses an earlier change.
export const CounterpartyChangeKind = Schema.Literals([
  ...CounterpartyChange.discriminants,
  "acceptCategory",
  "undo",
]);

export const CounterpartyRecord = Schema.Struct(Struct.omit(Counterparty.fields, ["updatedAt"]));
export const AliasRecord = Schema.Struct({
  aliasKey: Schema.String,
  counterpartyId: CounterpartyId,
  source: AssignmentAuthor,
  status: AssignmentStatus,
  confidence: Schema.NullOr(Schema.Finite),
  reason: Schema.NullOr(Schema.String),
  version: Version,
});
export const ReferenceRecord = Schema.Struct({
  counterpartyId: CounterpartyId,
  referenceKey: Schema.String,
  defaultRole: CounterpartyRole,
  defaultCategoryId: Schema.NullOr(CategoryId),
  version: Version,
});
export const EventAssignment = Schema.Struct(
  Struct.pick(FinancialEvent.fields, ["counterpartyId", "counterpartySource"]),
);
// Records as they were before a change and as it left them. A null image is a record
// that did not exist.
const Images = <S extends Schema.Top>(record: S) =>
  Schema.Array(Schema.Struct({ before: Schema.NullOr(record), after: Schema.NullOr(record) }));
// Every record a counterparty change wrote. Rules and movement-link snapshots hold only
// the counterparty they name, because only a merge changes them, pointing the ones that
// named its source at its target.
export const CounterpartyImages = Schema.Struct({
  counterparties: Images(CounterpartyRecord),
  aliases: Images(AliasRecord),
  references: Images(ReferenceRecord),
  events: Schema.Array(
    Schema.Struct({ eventId: EventId, before: EventAssignment, after: EventAssignment }),
  ),
  rules: Schema.Array(
    Schema.Struct({ ruleId: RuleId, before: CounterpartyId, after: CounterpartyId }),
  ),
  movements: Schema.Array(
    Schema.Struct({ eventId: EventId, before: CounterpartyId, after: CounterpartyId }),
  ),
});
export type CounterpartyImages = typeof CounterpartyImages.Type;

// `subjects` are the counterparties the change wrote, named as they were then, and
// `eventCount` the transactions whose meaning it changed. A change can be undone while
// every record it wrote is still as it left it.
export const CounterpartyChangeEntry = Schema.Struct({
  id: CounterpartyChangeId,
  kind: CounterpartyChangeKind,
  undoes: Schema.NullOr(Schema.Struct({ id: CounterpartyChangeId, kind: CounterpartyChangeKind })),
  images: CounterpartyImages,
  subjects: Schema.Array(Schema.Struct({ id: CounterpartyId, name: Schema.String })),
  eventCount: Schema.Int,
  createdAt: Instant,
  undoable: Schema.Boolean,
  undone: Schema.Boolean,
});
export const ListCounterpartyHistory = Schema.Struct({
  counterpartyId: CounterpartyId,
  cursor: Schema.optionalKey(RecordCursor),
});
export const CounterpartyHistoryPage = Schema.Struct({
  rows: Schema.Array(CounterpartyChangeEntry),
  nextCursor: Schema.NullOr(RecordCursor),
});
// `changeId` is null when the change left every record as it was.
export const CounterpartyChangeOutcome = Schema.Struct({
  changeId: Schema.NullOr(CounterpartyChangeId),
  counterparty: Counterparty,
});

export const PreviewCounterpartyUndo = Schema.Struct({ changeId: CounterpartyChangeId });
export const CounterpartyUndoPreview = Schema.Struct(
  Struct.omit(CounterpartyChangePreview.fields, ["change", "event"]),
);
export const UndoCounterpartyChange = Schema.Struct({
  commandId: CommandId,
  changeId: CounterpartyChangeId,
});
// `changeId` is the undo's own change. `removed` lists the counterparties the undo
// deleted, such as one whose creation it reversed.
export const CounterpartyUndoOutcome = Schema.Struct({
  changeId: CounterpartyChangeId,
  removed: Schema.Array(CounterpartyId),
});
