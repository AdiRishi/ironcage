import { PgClient } from "@effect/sql-pg";
import {
  Correction,
  CorrectionHistory,
  EventId,
  type FinancialEvent,
  FinanceError,
  type ExpectedEventVersion,
} from "@repo/contracts/finance";
import { isCost } from "@repo/finance";
import { Crypto, Effect, Schema } from "effect";

import { instant } from "../database/columns.ts";
import { readCredits, readFees, readMovement } from "../relationships/repository.ts";

export const checkEventVersions = Effect.fn("checkEventVersions")(function* (
  events: ReadonlyArray<FinancialEvent>,
  expected: ReadonlyArray<typeof ExpectedEventVersion.Type>,
) {
  if (
    events.length !== expected.length ||
    events.some(
      (event) =>
        !expected.some(
          (version) => version.eventId === event.id && version.version === event.version,
        ),
    )
  )
    return yield* new FinanceError({
      kind: "stale",
      message: "The interpretation changed. Keep your edit and preview it again.",
    });
});
export const correctionHistory = Effect.fn("correctionHistory")(function* (
  eventId: typeof EventId.Type,
) {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT id, event_id AS "eventId", command_id AS "commandId", prior, accepted, scope, ${instant(sql, sql("created_at"))} AS "createdAt" FROM corrections WHERE event_id = ${eventId} ORDER BY created_at DESC, id DESC`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(CorrectionHistory)),
  );
});
export const recordCorrection = Effect.fn("recordCorrection")(function* ({
  prior,
  accepted,
  commandId,
  scope,
}: Pick<typeof Correction.Type, "prior" | "accepted" | "commandId" | "scope">) {
  const sql = yield* PgClient.PgClient;
  const crypto = yield* Crypto.Crypto;
  yield* sql`INSERT INTO corrections (id, event_id, command_id, prior, accepted, scope) VALUES (${yield* crypto.randomUUIDv4}, ${prior.id}, ${commandId}, ${sql.json(yield* Schema.encodeEffect(Schema.toCodecJson(Correction.fields.prior))(prior))}, ${sql.json(yield* Schema.encodeEffect(Schema.toCodecJson(Correction.fields.accepted))(accepted))}, ${scope})`;
});

export const validateEventRelationships = Effect.fn("validateEventRelationships")(function* (
  event: FinancialEvent,
) {
  const sql = yield* PgClient.PgClient;
  const credits = yield* readCredits();
  for (const link of credits.filter(
    (link) => link.creditEventId === event.id || link.costEventId === event.id,
  )) {
    const isCredit = link.creditEventId === event.id;
    const allocation = event.allocations.find(
      (row) => row.id === (isCredit ? link.creditAllocationId : link.costAllocationId),
    );
    const applied = credits
      .filter((row) =>
        isCredit
          ? row.creditAllocationId === link.creditAllocationId
          : row.costAllocationId === link.costAllocationId,
      )
      .reduce((sum, row) => sum + row.amount.minor, 0n);
    if (
      !allocation ||
      allocation.amount.minor < applied ||
      (isCredit
        ? allocation.role !== "refund" && allocation.role !== "reimbursement"
        : !isCost(allocation.role))
    )
      return yield* new FinanceError({
        kind: "conflict",
        message:
          "Remove the applied credits before changing their allocation or reducing the amount below the credited total.",
      });
  }
  const movement = yield* readMovement(event.id);
  const [stored] = yield* sql`SELECT kind FROM events WHERE id=${event.id}`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ kind: Schema.String }))),
    ),
  );
  if (movement && stored?.kind !== event.kind)
    return yield* new FinanceError({
      kind: "conflict",
      message: "Unlink the movement before changing its role.",
    });
  for (const fee of yield* readFees(event.id)) {
    if (event.kind !== (fee.feeEventId === event.id ? "financingCost" : "purchase"))
      return yield* new FinanceError({
        kind: "conflict",
        message: "Remove the fee association before changing the role.",
      });
  }
});

export const writeEvent = Effect.fn("writeEvent")(function* (event: FinancialEvent) {
  const sql = yield* PgClient.PgClient;
  yield* validateEventRelationships(event);
  for (const allocation of event.allocations) {
    if (allocation.categoryId) {
      const rows = yield* sql`SELECT id FROM categories WHERE id = ${allocation.categoryId}`;
      if (rows.length === 0)
        return yield* new FinanceError({
          kind: "invalid",
          message: "Choose an existing category.",
        });
    }
    for (const [table, ids] of [
      ["tags", allocation.tagIds],
      ["personal_events", allocation.personalEventIds],
    ] as const) {
      if (ids.length > 0) {
        const rows = yield* sql`SELECT id FROM ${sql(table)} WHERE ${sql.in(
          "id",
          ids.map((id) => String(id)),
        )}`;
        if (rows.length !== new Set<string>(ids).size)
          return yield* new FinanceError({
            kind: "invalid",
            message: "A selected label no longer exists.",
          });
      }
    }
  }
  yield* sql`UPDATE events SET primary_posting_id = ${event.primaryPostingId}, reporting_account_id = ${event.reportingAccountId}, kind = ${event.kind}, role_source = ${event.roleSource}, counterparty_id = ${event.counterpartyId}, counterparty_source = ${event.counterpartySource}, purchase_on = ${event.purchaseOn}, version = ${event.version} WHERE id = ${event.id}`;
  const owned = yield* sql`SELECT id FROM allocations WHERE event_id <> ${event.id} AND ${sql.in(
    "id",
    event.allocations.map((allocation) => allocation.id),
  )}`;
  if (owned.length > 0)
    return yield* new FinanceError({
      kind: "conflict",
      message: "An allocation belongs to another event.",
    });
  yield* sql`DELETE FROM allocations WHERE event_id = ${event.id} AND NOT (${sql.in(
    "id",
    event.allocations.map((allocation) => allocation.id),
  )})`;
  for (const allocation of event.allocations) {
    yield* sql`INSERT INTO allocations (id, event_id, role, amount_minor, category_id, category_source, non_personal) VALUES (${allocation.id}, ${event.id}, ${allocation.role}, ${allocation.amount.minor}, ${allocation.categoryId}, ${allocation.categorySource}, ${allocation.nonPersonal}) ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, amount_minor = EXCLUDED.amount_minor, category_id = EXCLUDED.category_id, category_source = EXCLUDED.category_source, non_personal = EXCLUDED.non_personal`;
    yield* sql`DELETE FROM allocation_tags WHERE allocation_id = ${allocation.id}`;
    yield* sql`DELETE FROM allocation_personal_events WHERE allocation_id = ${allocation.id}`;
    for (const tagId of new Set(allocation.tagIds))
      yield* sql`INSERT INTO allocation_tags (allocation_id, tag_id) VALUES (${allocation.id}, ${tagId})`;
    for (const personalEventId of new Set(allocation.personalEventIds))
      yield* sql`INSERT INTO allocation_personal_events (allocation_id, personal_event_id) VALUES (${allocation.id}, ${personalEventId})`;
  }
});
