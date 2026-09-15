import { Schema } from "effect";

import { CategoryId, MerchantId, TagId, PersonalEventId } from "./interpretation.ts";
import { CalendarDate, CommandId, Version } from "./values.ts";

const Name = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const CategoryTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create") }),
  Schema.Struct({ kind: Schema.Literal("update"), id: CategoryId, expectedVersion: Version }),
]);
const MerchantTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create") }),
  Schema.Struct({ kind: Schema.Literal("update"), id: MerchantId, expectedVersion: Version }),
]);
const TagTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create") }),
  Schema.Struct({ kind: Schema.Literal("update"), id: TagId, expectedVersion: Version }),
]);
const PersonalEventTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create") }),
  Schema.Struct({ kind: Schema.Literal("update"), id: PersonalEventId, expectedVersion: Version }),
]);
export const ReferenceWrite = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("category"),
    target: CategoryTarget,
    name: Name,
    parentId: Schema.NullOr(CategoryId),
    archived: Schema.Boolean,
  }),
  Schema.Struct({
    kind: Schema.Literal("merchant"),
    target: MerchantTarget,
    name: Name,
    aliases: Schema.Array(Name),
  }),
  Schema.Struct({ kind: Schema.Literal("tag"), target: TagTarget, name: Name }),
  Schema.Struct({
    kind: Schema.Literal("personalEvent"),
    target: PersonalEventTarget,
    name: Name,
    startOn: CalendarDate,
    endOn: CalendarDate,
    excludeFromOrdinary: Schema.Boolean,
  }),
]);
export const SaveReference = Schema.Struct({ commandId: CommandId, record: ReferenceWrite });
export const DeleteReference = Schema.Struct({
  commandId: CommandId,
  record: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("category"), id: CategoryId, expectedVersion: Version }),
    Schema.Struct({ kind: Schema.Literal("merchant"), id: MerchantId, expectedVersion: Version }),
    Schema.Struct({ kind: Schema.Literal("tag"), id: TagId, expectedVersion: Version }),
    Schema.Struct({
      kind: Schema.Literal("personalEvent"),
      id: PersonalEventId,
      expectedVersion: Version,
    }),
  ]),
});
