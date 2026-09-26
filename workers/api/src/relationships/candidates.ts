import { PgClient } from "@effect/sql-pg";
import {
  EventId,
  type ListRelationshipCandidates,
  type RelationshipCandidatePage,
} from "@repo/contracts/finance";
import { isCost, remainingAllocation } from "@repo/finance";
import { Effect, Schema } from "effect";

import { containsText } from "../database/columns.ts";
import { readEvent } from "../events/repository.ts";
import { readCredits } from "./repository.ts";

export const relationshipCandidates = Effect.fn("relationshipCandidates")(function* (
  input: typeof ListRelationshipCandidates.Type,
) {
  const sql = yield* PgClient.PgClient;
  const event = yield* readEvent(input.eventId);
  const primary = event.postings[0];
  const role =
    input.kind === "cost"
      ? sql`e.kind IN ('purchase','financingCost')`
      : input.kind === "purchase"
        ? sql`e.kind='purchase'`
        : sql`NOT EXISTS (SELECT 1 FROM movement_links m WHERE m.event_id=e.id) AND (SELECT count(*) FROM event_postings ep WHERE ep.event_id=e.id AND ep.active)=1 AND p.account_id<>${primary?.accountId ?? event.reportingAccountId} AND p.amount_minor=${-(primary?.amount.minor ?? 0n)}`;
  const cursor = input.cursor
    ? sql`AND (p.posted_on,p.id)<(${input.cursor.postedOn}::date,${input.cursor.id}::uuid)`
    : sql``;
  const ids =
    yield* sql`SELECT e.id FROM events e JOIN postings p ON p.id=e.primary_posting_id WHERE e.active AND e.id<>${event.id} AND e.currency=${event.magnitude.currency} AND ${role} AND ${containsText(sql, sql("p.description"), input.search)} ${cursor} ORDER BY p.posted_on DESC,p.id DESC LIMIT 51`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: EventId })))),
    );
  const events = yield* Effect.forEach(ids.slice(0, 50), (row) => readEvent(row.id));
  const links = yield* readCredits();
  const rows = events.flatMap((candidate) => {
    const posting = candidate.postings.find((row) => row.id === candidate.primaryPostingId);
    return posting
      ? candidate.allocations
          .filter((allocation) => input.kind !== "cost" || isCost(allocation.role))
          .map((allocation) => ({
            eventId: candidate.id,
            allocationId: allocation.id,
            kind: candidate.kind,
            version: candidate.version,
            posting,
            remaining: {
              currency: candidate.magnitude.currency,
              minor: remainingAllocation(candidate, allocation.id, links),
            },
          }))
      : [];
  });
  const last = rows.at(-1)?.posting;
  return {
    rows,
    nextCursor: ids.length > 50 && last ? { id: last.id, postedOn: last.postedOn } : null,
  } satisfies typeof RelationshipCandidatePage.Type;
});
