import { PgClient } from "@effect/sql-pg";
import { SaveReference, DeleteReference, FinanceError } from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";

const tables = {
  category: "categories",
  merchant: "merchants",
  tag: "tags",
  personalEvent: "personal_events",
} as const;
export class References extends Context.Service<
  References,
  {
    readonly save: (input: typeof SaveReference.Type) => Effect.Effect<boolean, FinanceError>;
    readonly remove: (input: typeof DeleteReference.Type) => Effect.Effect<boolean, FinanceError>;
  }
>()("@repo/api/references/References") {
  static readonly layer = Layer.effect(
    References,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const checkVersion = Effect.fn("References.checkVersion")(function* (
        table: string,
        id: string,
        version: number,
      ) {
        const [row] = yield* sql`SELECT version FROM ${sql(table)} WHERE id = ${id}`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ version: Schema.Int }))),
          ),
        );
        if (!row)
          return yield* new FinanceError({
            kind: "notFound",
            message: "Reference record not found.",
          });
        if (row.version !== version)
          return yield* new FinanceError({
            kind: "stale",
            message: "This reference changed. Refresh it before saving.",
          });
      });
      const save = Effect.fn("References.save")(function* (input: typeof SaveReference.Type) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "saveReference", ...input },
          result: Schema.Boolean,
          execute: Effect.gen(function* () {
            const record = input.record;
            const table = tables[record.kind];
            const id =
              record.target.kind === "create" ? yield* crypto.randomUUIDv4 : record.target.id;
            if (record.target.kind === "update")
              yield* checkVersion(table, id, record.target.expectedVersion);
            if (record.kind === "category" && record.parentId) {
              const parents =
                yield* sql`WITH RECURSIVE parents AS (SELECT id, parent_id FROM categories WHERE id = ${record.parentId} UNION ALL SELECT c.id,c.parent_id FROM categories c JOIN parents p ON p.parent_id = c.id) SELECT id FROM parents`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ id: Schema.String }))),
                  ),
                );
              if (
                parents.length === 0 ||
                record.parentId === id ||
                parents.some((parent) => parent.id === id)
              )
                return yield* new FinanceError({
                  kind: "conflict",
                  message: "Choose an existing parent outside this category's descendants.",
                });
            }
            if (
              record.kind === "category" &&
              record.archived &&
              (yield* sql`SELECT id FROM rules WHERE action->>'categoryId'=${id}`).length
            )
              return yield* new FinanceError({
                kind: "conflict",
                message: "Change or remove rules assigning this category before archiving it.",
              });
            if (record.kind === "personalEvent" && record.endOn < record.startOn)
              return yield* new FinanceError({
                kind: "invalid",
                message: "The end date must be on or after the start date.",
              });
            if (record.target.kind === "create") {
              if (record.kind === "personalEvent")
                yield* sql`INSERT INTO personal_events (id,name,start_on,end_on,exclude_from_ordinary) VALUES (${id},${record.name},${record.startOn},${record.endOn},${record.excludeFromOrdinary})`;
              else yield* sql`INSERT INTO ${sql(table)} (id,name) VALUES (${id},${record.name})`;
            } else
              yield* sql`UPDATE ${sql(table)} SET name=${record.name},version=version+1 WHERE id=${id}`;
            if (record.kind === "category")
              yield* sql`UPDATE categories SET parent_id=${record.parentId},archived=${record.archived} WHERE id=${id}`;
            if (record.kind === "personalEvent")
              yield* sql`UPDATE personal_events SET start_on=${record.startOn},end_on=${record.endOn},exclude_from_ordinary=${record.excludeFromOrdinary} WHERE id=${id}`;
            if (record.kind === "merchant") {
              yield* sql`DELETE FROM merchant_aliases WHERE merchant_id=${id}`;
              for (const alias of new Set(
                record.aliases.map((value) => value.trim().toLowerCase()),
              ))
                yield* sql`INSERT INTO merchant_aliases (merchant_id,pattern) VALUES (${id},${alias})`;
            }
            return true;
          }),
        });
      }, toFinanceError);
      const remove = Effect.fn("References.remove")(function* (input: typeof DeleteReference.Type) {
        return yield* commands.run({
          commandId: input.commandId,
          input: { operation: "deleteReference", ...input },
          result: Schema.Boolean,
          execute: Effect.gen(function* () {
            const record = input.record;
            yield* checkVersion(tables[record.kind], record.id, record.expectedVersion);
            const usage =
              record.kind === "category"
                ? sql`SELECT id FROM allocations WHERE category_id=${record.id} UNION ALL SELECT id FROM categories WHERE parent_id=${record.id} UNION ALL SELECT id FROM rules WHERE action->>'categoryId'=${record.id}`
                : record.kind === "merchant"
                  ? sql`SELECT id FROM allocations WHERE merchant_id=${record.id} UNION ALL SELECT id FROM rules WHERE conditions->>'merchantId'=${record.id}`
                  : record.kind === "tag"
                    ? sql`SELECT allocation_id FROM allocation_tags WHERE tag_id=${record.id}`
                    : sql`SELECT allocation_id FROM allocation_personal_events WHERE personal_event_id=${record.id}`;
            if ((yield* usage).length > 0)
              return yield* new FinanceError({
                kind: "conflict",
                message:
                  "This reference is in use. Remove its assignments first, or archive the category.",
              });
            if (record.kind === "merchant")
              yield* sql`DELETE FROM merchant_aliases WHERE merchant_id=${record.id}`;
            yield* sql`DELETE FROM ${sql(tables[record.kind])} WHERE id=${record.id}`;
            return true;
          }),
        });
      }, toFinanceError);
      return References.of({ save, remove });
    }),
  );
}
