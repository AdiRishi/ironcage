import { Schema } from "effect";

import {
  EventId,
  AllocationId,
  CategoryId,
  CategorySource,
  CategoryTree,
  CounterpartyId,
  CounterpartyKind,
  CounterpartySource,
  RoleSource,
  TagId,
  PersonalEventId,
  FinancialRole,
  AllocationRole,
} from "./interpretation.ts";
import { Posting } from "./postings.ts";
import { AccountId, CalendarDate, Money, PostingId, Version } from "./values.ts";
export const Allocation = Schema.Struct({
  id: AllocationId,
  role: AllocationRole,
  amount: Money,
  categoryId: Schema.NullOr(CategoryId),
  categorySource: Schema.NullOr(CategorySource),
  nonPersonal: Schema.Boolean,
  tagIds: Schema.Array(TagId),
  personalEventIds: Schema.Array(PersonalEventId),
});
export const FinancialEvent = Schema.Struct({
  id: EventId,
  kind: FinancialRole,
  roleSource: Schema.NullOr(RoleSource),
  counterpartyId: Schema.NullOr(CounterpartyId),
  counterpartySource: Schema.NullOr(CounterpartySource),
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
export const EventInput = Schema.Struct({ eventId: EventId });
export const EventForPosting = Schema.Struct({ postingId: PostingId });
export const ReferenceData = Schema.Struct({
  categories: Schema.Array(
    Schema.Struct({
      id: CategoryId,
      parentId: Schema.NullOr(CategoryId),
      name: Schema.String,
      slug: Schema.NullOr(Schema.String),
      tree: CategoryTree,
      position: Schema.Int,
      archived: Schema.Boolean,
      version: Version,
    }),
  ),
  counterparties: Schema.Array(
    Schema.Struct({
      id: CounterpartyId,
      name: Schema.String,
      kind: CounterpartyKind,
      version: Version,
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
