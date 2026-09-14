import { PgClient } from "@effect/sql-pg";
import {
  Import,
  ImportInput,
  ImportSource,
  FinanceError,
  FailImport,
  ListImports,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { databaseUnavailable } from "../database/commands.ts";

export class ImportRepository extends Context.Service<
  ImportRepository,
  {
    readonly list: (
      input?: typeof ListImports.Type,
    ) => Effect.Effect<ReadonlyArray<Import>, FinanceError>;
    readonly get: (input: typeof ImportInput.Type) => Effect.Effect<Import, FinanceError>;
    readonly source: (
      input: typeof ImportInput.Type,
    ) => Effect.Effect<typeof ImportSource.Type, FinanceError>;
    readonly fail: (input: typeof FailImport.Type) => Effect.Effect<void, FinanceError>;
  }
>()("@repo/api/imports/ImportRepository") {
  static readonly layer = Layer.effect(
    ImportRepository,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const fields = sql`i.id, i.source_file_id AS "sourceFileId", i.account_id AS "accountId", s.file_name AS "fileName", i.format, i.status, i.summary, i.failure, i.version, to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"`;
      const list = Effect.fn("Imports.list")(function* (input: typeof ListImports.Type = {}) {
        const condition = input.cursor
          ? sql`(i.created_at, i.id) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`
          : sql`true`;
        return yield* sql`SELECT ${fields} FROM imports i JOIN source_files s ON s.id = i.source_file_id WHERE ${condition} ORDER BY i.created_at DESC, i.id DESC LIMIT 100`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Import))),
          Effect.mapError(databaseUnavailable),
        );
      });
      const get = Effect.fn("Imports.get")(function* ({ importId }: typeof ImportInput.Type) {
        const imports =
          yield* sql`SELECT ${fields} FROM imports i JOIN source_files s ON s.id = i.source_file_id WHERE i.id = ${importId}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Import))),
            Effect.mapError(databaseUnavailable),
          );
        const item = imports[0];
        if (!item)
          return yield* new FinanceError({ kind: "notFound", message: "Import not found." });
        return item;
      });
      const source = Effect.fn("Imports.source")(function* ({ importId }: typeof ImportInput.Type) {
        const imports =
          yield* sql`SELECT i.id AS "importId", s.object_key AS "objectKey", i.format, COALESCE(a.currency, 'AUD') AS currency, s.bytes_available AS "bytesAvailable" FROM imports i JOIN source_files s ON s.id = i.source_file_id LEFT JOIN accounts a ON a.id = i.account_id WHERE i.id = ${importId}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ImportSource))),
            Effect.mapError(databaseUnavailable),
          );
        const item = imports[0];
        if (!item)
          return yield* new FinanceError({ kind: "notFound", message: "Import not found." });
        return item;
      });
      const fail = Effect.fn("Imports.fail")(function* ({
        importId,
        failure,
        instanceId,
      }: typeof FailImport.Type) {
        yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`SELECT pg_advisory_xact_lock(1)`;
              yield* sql`UPDATE imports SET status = 'failed', failure = ${sql.json(failure)}, version = version + 1, updated_at = now() WHERE id = ${importId} AND status = 'processing' AND workflow_instance_id = ${instanceId}`;
            }),
          )
          .pipe(Effect.mapError(databaseUnavailable));
      });
      return ImportRepository.of({ list, get, source, fail });
    }),
  );
}
