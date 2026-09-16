import { PgClient } from "@effect/sql-pg";
import {
  AnalysisId,
  SavedAnalysis,
  type SaveAnalysis,
  type GetAnalysis,
  type RenameAnalysis,
  type DeleteAnalysis,
  FinanceError,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { instant } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";

export class SavedAnalyses extends Context.Service<
  SavedAnalyses,
  {
    readonly list: Effect.Effect<readonly SavedAnalysis[], FinanceError>;
    readonly get: (input: typeof GetAnalysis.Type) => Effect.Effect<SavedAnalysis, FinanceError>;
    readonly save: (input: typeof SaveAnalysis.Type) => Effect.Effect<SavedAnalysis, FinanceError>;
    readonly rename: (
      input: typeof RenameAnalysis.Type,
    ) => Effect.Effect<SavedAnalysis, FinanceError>;
    readonly remove: (input: typeof DeleteAnalysis.Type) => Effect.Effect<boolean, FinanceError>;
  }
>()("@repo/api/analysis/SavedAnalyses") {
  static readonly layer = Layer.effect(
    SavedAnalyses,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const commands = yield* Commands;
      const fields = sql`id,name,query AS definition,version,${instant(sql, sql("created_at"))} AS "createdAt",${instant(sql, sql("updated_at"))} AS "updatedAt"`;
      const get = Effect.fn("SavedAnalyses.get")(function* ({ id }: typeof GetAnalysis.Type) {
        const [row] = yield* sql`SELECT ${fields} FROM saved_analyses WHERE id=${id}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SavedAnalysis))),
        );
        if (!row)
          return yield* new FinanceError({
            kind: "notFound",
            message: "This saved analysis no longer exists.",
          });
        return row;
      }, toFinanceError);
      const list = sql`SELECT ${fields} FROM saved_analyses ORDER BY name,id`.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SavedAnalysis))),
        toFinanceError,
      );
      const save = Effect.fn("SavedAnalyses.save")((input: typeof SaveAnalysis.Type) =>
        commands.run({
          commandId: input.commandId,
          input: { operation: "saveAnalysis", ...input },
          result: SavedAnalysis,
          execute: Effect.gen(function* () {
            const id = AnalysisId.make(yield* crypto.randomUUIDv4);
            yield* sql`INSERT INTO saved_analyses (id,name,query) VALUES (${id},${input.name},${sql.json(input.definition)})`;
            return yield* get({ id });
          }),
        }),
      );
      const rename = Effect.fn("SavedAnalyses.rename")((input: typeof RenameAnalysis.Type) =>
        commands.run({
          commandId: input.commandId,
          input: { operation: "renameAnalysis", ...input },
          result: SavedAnalysis,
          execute: Effect.gen(function* () {
            const rows =
              yield* sql`UPDATE saved_analyses SET name=${input.name},version=version+1,updated_at=now() WHERE id=${input.id} AND version=${input.expectedVersion} RETURNING id`;
            if (!rows.length)
              return yield* new FinanceError({
                kind: "stale",
                message: "This analysis changed. Refresh it before renaming.",
              });
            return yield* get({ id: input.id });
          }),
        }),
      );
      const remove = Effect.fn("SavedAnalyses.remove")((input: typeof DeleteAnalysis.Type) =>
        commands.run({
          commandId: input.commandId,
          input: { operation: "deleteAnalysis", ...input },
          result: Schema.Boolean,
          execute: Effect.gen(function* () {
            const rows =
              yield* sql`DELETE FROM saved_analyses WHERE id=${input.id} AND version=${input.expectedVersion} RETURNING id`;
            if (!rows.length)
              return yield* new FinanceError({
                kind: "stale",
                message: "This analysis changed. Refresh it before deleting.",
              });
            return true;
          }),
        }),
      );
      return SavedAnalyses.of({ get, list, save, rename, remove });
    }),
  );
}
