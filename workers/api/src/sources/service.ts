import { PgClient } from "@effect/sql-pg";
import {
  FinanceError,
  RemoveSourceBytes,
  SourceFile,
  SourceRemoval,
} from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";

import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { Sources } from "../platform/services.ts";

const RemovalReceipt = Schema.Struct({ ...SourceRemoval.fields, objectKey: Schema.String });
const StoredSource = Schema.Struct({
  version: Schema.Int,
  objectKey: Schema.String,
  postingCount: Schema.Int,
});
const make = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const sources = yield* Sources;
  const commands = yield* Commands;
  const list =
    sql`SELECT s.id, s.file_name AS "fileName", s.byte_size::text AS "byteSize", s.bytes_available AS "bytesAvailable", s.version, i.id AS "importId", i.format, i.status,
        count(DISTINCT o.posting_id)::integer AS "postingCount",
        COALESCE(i.account_id, min(p.account_id::text)::uuid) AS "accountId",
        min(p.posted_on)::text AS "firstOn", max(p.posted_on)::text AS "lastOn"
      FROM source_files s JOIN imports i ON i.source_file_id = s.id
      LEFT JOIN observations o ON o.source_file_id = s.id
      LEFT JOIN postings p ON p.id = o.posting_id
      GROUP BY s.id, i.id
      ORDER BY max(p.posted_on) DESC NULLS FIRST, s.uploaded_at DESC, s.id DESC`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SourceFile))),
      toFinanceError,
      Effect.withSpan("SourceFiles.list"),
    );
  // The receipt keeps the object key that was current when the command first ran, so a
  // repeat after a reupload deletes only that object and never the replacement.
  const remove = Effect.fn("SourceFiles.remove")(function* (input: typeof RemoveSourceBytes.Type) {
    const receipt = yield* commands.run({
      commandId: input.commandId,
      input: { operation: "removeSourceBytes", ...input },
      result: Schema.toCodecJson(RemovalReceipt),
      execute: Effect.gen(function* () {
        const [source] =
          yield* sql`SELECT version, object_key AS "objectKey", (SELECT count(DISTINCT posting_id)::integer FROM observations WHERE source_file_id = s.id) AS "postingCount" FROM source_files s WHERE id = ${input.sourceFileId}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredSource))),
          );
        if (!source)
          return yield* new FinanceError({ kind: "notFound", message: "Source file not found." });
        if (source.version !== input.expectedVersion)
          return yield* new FinanceError({
            kind: "stale",
            message: "This file changed. Refresh before removing its bytes.",
          });
        yield* sql`UPDATE source_files SET bytes_available = false, version = version + 1 WHERE id = ${input.sourceFileId}`;
        return {
          sourceFileId: input.sourceFileId,
          objectKey: source.objectKey,
          affectedPostingCount: source.postingCount,
        };
      }),
    });
    yield* sources.delete(receipt.objectKey).pipe(
      Effect.mapError(
        () =>
          new FinanceError({
            kind: "unavailable",
            message: "The original bytes could not be removed. Retry this removal.",
          }),
      ),
    );
    return {
      sourceFileId: receipt.sourceFileId,
      affectedPostingCount: receipt.affectedPostingCount,
    };
  });
  return { list, remove };
});
export class SourceFiles extends Context.Service<SourceFiles, Effect.Success<typeof make>>()(
  "@repo/api/sources/SourceFiles",
) {
  static readonly layer = Layer.effect(SourceFiles, make);
}
