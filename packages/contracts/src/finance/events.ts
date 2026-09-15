import { Schema } from "effect";

import {
  EventId,
  AllocationId,
  CategoryId,
  MerchantId,
  TagId,
  PersonalEventId,
  FinancialRole,
  AllocationRole,
} from "./interpretation.ts";
import { Posting } from "./postings.ts";
import { AccountId, CalendarDate, CommandId, Money, PostingId, Version } from "./values.ts";
export const Allocation = Schema.Struct({
  id: AllocationId,
  role: AllocationRole,
  amount: Money,
  categoryId: Schema.NullOr(CategoryId),
  merchantId: Schema.NullOr(MerchantId),
  nonPersonal: Schema.Boolean,
  tagIds: Schema.Array(TagId),
  personalEventIds: Schema.Array(PersonalEventId),
});
export const FinancialEvent = Schema.Struct({
  id: EventId,
  kind: FinancialRole,
  magnitude: Money,
  primaryPostingId: PostingId,
  reportingAccountId: AccountId,
  purchaseOn: Schema.NullOr(CalendarDate),
  active: Schema.Boolean,
  version: Version,
  allocations: Schema.NonEmptyArray(Allocation),
  postings: Schema.Array(Posting),
});
export type FinancialEvent = typeof FinancialEvent.Type;
export const InterpretPostings = Schema.Struct({
  commandId: CommandId,
  scope: Schema.Union([Schema.Literal("all"), Schema.NonEmptyArray(PostingId)]),
});
export const InterpretationSummary = Schema.Struct({
  created: Schema.Int,
  counts: Schema.Array(Schema.Struct({ role: FinancialRole, count: Schema.Int })),
  remaining: Schema.Int,
});
export const EventInput = Schema.Struct({ eventId: EventId });
export const EventForPosting = Schema.Struct({ postingId: PostingId });
export const ReferenceData = Schema.Struct({
  categories: Schema.Array(
    Schema.Struct({
      id: CategoryId,
      parentId: Schema.NullOr(CategoryId),
      name: Schema.String,
      archived: Schema.Boolean,
      version: Version,
    }),
  ),
  merchants: Schema.Array(
    Schema.Struct({
      id: MerchantId,
      name: Schema.String,
      version: Version,
      aliases: Schema.Array(Schema.String),
    }),
  ),
  tags: Schema.Array(Schema.Struct({ id: TagId, name: Schema.String, version: Version })),
  personalEvents: Schema.Array(
    Schema.Struct({
      id: PersonalEventId,
      name: Schema.String,
      startOn: CalendarDate,
      endOn: CalendarDate,
      excludeFromOrdinary: Schema.Boolean,
      version: Version,
    }),
  ),
});
