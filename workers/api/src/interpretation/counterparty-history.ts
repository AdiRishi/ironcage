import { PgClient } from "@effect/sql-pg";
import {
  CounterpartyChangeEntry,
  CounterpartyChangeId,
  type CounterpartyHistoryPage,
  CounterpartyId,
  CounterpartyImages,
  CounterpartyUndoOutcome,
  type CounterpartyUndoPreview,
  FinanceError,
  type ListCounterpartyHistory,
  type PreviewCounterpartyUndo,
  UndoCounterpartyChange,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema, Struct } from "effect";
import type { Statement } from "effect/unstable/sql";

import { previewWrite } from "../analysis/preview.ts";
import { instant } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { readTransaction } from "../database/transactions.ts";
import {
  applyImages,
  invert,
  isCurrent,
  readCurrent,
  recordChange,
} from "./counterparty-changes.ts";

const pageSize = 20;

// Counterparty changes matching `where`, newest first, `limit` of them or all when it is
// null. A change can be undone while it has not been undone and every record it wrote
// is still as it left it.
export const readChangeEntries = Effect.fn("readChangeEntries")(function* (
  where: Statement.Fragment,
  limit: number | null,
) {
  const sql = yield* PgClient.PgClient;
  const rows = yield* sql`SELECT c.id, c.kind, c.images,
      CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object('id', u.id, 'kind', u.kind) END AS undoes,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.counterparty_id, 'name', s.name) ORDER BY s.name, s.counterparty_id)
        FROM counterparty_change_subjects s WHERE s.change_id = c.id), '[]'::jsonb) AS subjects,
      (SELECT count(*) FROM counterparty_change_events ce WHERE ce.change_id = c.id)::int AS "eventCount",
      ${instant(sql, sql("c.created_at"))} AS "createdAt",
      EXISTS (SELECT 1 FROM counterparty_changes x WHERE x.undoes = c.id) AS undone
    FROM counterparty_changes c LEFT JOIN counterparty_changes u ON u.id = c.undoes
    WHERE ${where}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ${limit}`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(CounterpartyChangeEntry.mapFields(Struct.omit(["undoable"]))),
      ),
    ),
  );
  const current = yield* readCurrent(rows.map((row) => row.images));
  return rows.map((row) => ({ ...row, undoable: !row.undone && isCurrent(row.images, current) }));
});

// The name of each counterparty, or the name history last gave one that no longer
// exists. A counterparty deleted before history was kept has no name.
export const readCounterpartyNames = Effect.fn("readCounterpartyNames")(function* (
  ids: readonly (typeof CounterpartyId.Type)[],
) {
  if (ids.length === 0) return [];
  const sql = yield* PgClient.PgClient;
  const rows =
    yield* sql`SELECT i.id, COALESCE(c.name, (SELECT s.name FROM counterparty_change_subjects s
        JOIN counterparty_changes x ON x.id = s.change_id WHERE s.counterparty_id = i.id
        ORDER BY x.created_at DESC, x.id DESC LIMIT 1)) AS name
    FROM unnest(${ids}::uuid[]) AS i(id) LEFT JOIN counterparties c ON c.id = i.id`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ id: CounterpartyId, name: Schema.NullOr(Schema.String) })),
        ),
      ),
    );
  return rows.flatMap(({ id, name }) => (name === null ? [] : [{ id, name }]));
});

// Writes back what a change replaced. It fails while a later change has left any of
// those records different, so changes to one record are undone last first.
const undoWrite = Effect.fn("undoWrite")(function* (changeId: typeof CounterpartyChangeId.Type) {
  const sql = yield* PgClient.PgClient;
  const [change] =
    yield* sql`SELECT c.images, EXISTS (SELECT 1 FROM counterparty_changes x WHERE x.undoes = c.id) AS undone
      FROM counterparty_changes c WHERE c.id = ${changeId}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(Schema.Struct({ images: CounterpartyImages, undone: Schema.Boolean })),
        ),
      ),
    );
  if (!change)
    return yield* new FinanceError({ kind: "notFound", message: "Counterparty change not found." });
  if (change.undone)
    return yield* new FinanceError({ kind: "stale", message: "This change was already undone." });
  const current = yield* readCurrent([change.images]);
  if (!isCurrent(change.images, current))
    return yield* new FinanceError({
      kind: "stale",
      message: "A later change touched these records. Undo it first.",
    });
  const images = invert(change.images, current);
  yield* applyImages(images);
  return {
    images,
    removed: images.counterparties.flatMap(({ before, after }) =>
      before && !after ? [before.id] : [],
    ),
  };
});

export class CounterpartyHistory extends Context.Service<
  CounterpartyHistory,
  {
    readonly list: (
      input: typeof ListCounterpartyHistory.Type,
    ) => Effect.Effect<typeof CounterpartyHistoryPage.Type, FinanceError>;
    readonly previewUndo: (
      input: typeof PreviewCounterpartyUndo.Type,
    ) => Effect.Effect<typeof CounterpartyUndoPreview.Type, FinanceError>;
    readonly undo: (
      input: typeof UndoCounterpartyChange.Type,
    ) => Effect.Effect<typeof CounterpartyUndoOutcome.Type, FinanceError>;
  }
>()("@repo/api/interpretation/CounterpartyHistory") {
  static readonly layer = Layer.effect(
    CounterpartyHistory,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const provide = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient | Crypto.Crypto>) =>
        effect.pipe(
          Effect.provideService(PgClient.PgClient, sql),
          Effect.provideService(Crypto.Crypto, crypto),
        );

      const list = Effect.fn("CounterpartyHistory.list")(
        function* ({ counterpartyId, cursor }: typeof ListCounterpartyHistory.Type) {
          const rows = yield* readTransaction(
            sql,
            readChangeEntries(
              sql`c.id IN (SELECT s.change_id FROM counterparty_change_subjects s WHERE s.counterparty_id = ${counterpartyId})
                AND ${cursor ? sql`(c.created_at, c.id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : sql`true`}`,
              pageSize + 1,
            ),
          );
          const page = rows.slice(0, pageSize);
          const last = page.at(-1);
          return {
            rows: page,
            nextCursor:
              rows.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null,
          };
        },
        provide,
        toFinanceError,
      );

      const previewUndo = Effect.fn("CounterpartyHistory.previewUndo")(
        function* ({ changeId }: typeof PreviewCounterpartyUndo.Type) {
          const { eventCount, impacts } = yield* previewWrite(undoWrite(changeId));
          return { eventCount, impacts };
        },
        provide,
        toFinanceError,
      );

      const undo = Effect.fn("CounterpartyHistory.undo")(
        function* (input: typeof UndoCounterpartyChange.Type) {
          return yield* commands.run({
            commandId: input.commandId,
            input: { operation: "undoCounterpartyChange", ...input },
            result: Schema.toCodecJson(CounterpartyUndoOutcome),
            execute: Effect.gen(function* () {
              const { images, removed } = yield* undoWrite(input.changeId);
              return {
                changeId: yield* recordChange({
                  commandId: input.commandId,
                  kind: "undo",
                  undoes: input.changeId,
                  images,
                }),
                removed,
              };
            }),
          });
        },
        provide,
        toFinanceError,
      );

      return CounterpartyHistory.of({ list, previewUndo, undo });
    }),
  );
}
