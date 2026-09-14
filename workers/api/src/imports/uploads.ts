import { PgClient } from "@effect/sql-pg";
import {
  FinanceError,
  ImportId,
  SourceFileId,
  SourceFileInput,
  UploadInput,
  UploadResult,
} from "@repo/contracts/finance";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Context, Crypto, Effect, Encoding, Layer, Schema } from "effect";

import { databaseUnavailable } from "../database/commands.ts";
import { ImportJobs, Sources } from "../platform/services.ts";
import { ImportRepository } from "./repository.ts";

const StoredSource = Schema.Struct({
  sourceFileId: SourceFileId,
  importId: ImportId,
  bytesAvailable: Schema.Boolean,
});
const Download = Schema.Struct({
  objectKey: Schema.String,
  fileName: Schema.String,
  bytesAvailable: Schema.Boolean,
});
export class Uploads extends Context.Service<
  Uploads,
  {
    readonly upload: (
      input: UploadInput,
    ) => Effect.Effect<typeof UploadResult.Type, FinanceError, RuntimeContext>;
    readonly download: (input: typeof SourceFileInput.Type) => Effect.Effect<
      {
        fileName: string;
        object: NonNullable<Effect.Success<ReturnType<Sources["Service"]["get"]>>>;
      },
      FinanceError,
      RuntimeContext
    >;
  }
>()("@repo/api/imports/Uploads") {
  static readonly layer = Layer.effect(
    Uploads,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const sources = yield* Sources;
      const jobs = yield* ImportJobs;
      const imports = yield* ImportRepository;
      const upload = Effect.fn("Uploads.upload")(
        function* (input: UploadInput) {
          const format = input.fileName.toLowerCase().endsWith(".csv")
            ? "csv"
            : input.fileName.toLowerCase().endsWith(".ofx")
              ? "ofx"
              : null;
          if (!format)
            return yield* new FinanceError({
              kind: "invalid",
              message: "Choose a CSV or OFX file.",
            });
          if (format === "csv" && !input.accountId)
            return yield* new FinanceError({
              kind: "invalid",
              message: "Choose an account for this CSV.",
            });
          const hash = Encoding.encodeHex(yield* crypto.digest("SHA-256", input.bytes));
          const existing =
            yield* sql`SELECT s.id AS "sourceFileId", i.id AS "importId", s.bytes_available AS "bytesAvailable" FROM source_files s JOIN imports i ON i.source_file_id = s.id WHERE s.sha256 = ${hash} ORDER BY i.created_at DESC LIMIT 1`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredSource))),
            );
          if (existing[0]?.bytesAvailable) return { ...existing[0], existing: true };
          const uploadId = yield* crypto.randomUUIDv4;
          const objectKey = `sources/${hash}/${uploadId}`;
          yield* sources.put(objectKey, input.bytes, {
            httpMetadata: { contentType: input.mediaType || "application/octet-stream" },
          });
          const importId = ImportId.make(yield* crypto.randomUUIDv4);
          const sourceFileId = SourceFileId.make(yield* crypto.randomUUIDv4);
          const result = yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SELECT pg_advisory_xact_lock(1)`;
              const concurrent =
                yield* sql`SELECT s.id AS "sourceFileId", i.id AS "importId", s.bytes_available AS "bytesAvailable" FROM source_files s JOIN imports i ON i.source_file_id = s.id WHERE s.sha256 = ${hash} ORDER BY i.created_at DESC LIMIT 1`.pipe(
                  Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredSource))),
                );
              const found = concurrent[0];
              if (found) {
                if (!found.bytesAvailable)
                  yield* sql`UPDATE source_files SET object_key = ${objectKey}, bytes_available = true, version = version + 1 WHERE id = ${found.sourceFileId}`;
                return {
                  sourceFileId: found.sourceFileId,
                  importId: found.importId,
                  existing: true,
                  discardObject: found.bytesAvailable,
                };
              }
              if (input.accountId) {
                const accounts = yield* sql`SELECT id FROM accounts WHERE id = ${input.accountId}`;
                if (accounts.length === 0)
                  return yield* new FinanceError({
                    kind: "notFound",
                    message: "Account not found.",
                  });
              }
              yield* sql`INSERT INTO source_files ${sql.insert({ id: sourceFileId, sha256: hash, file_name: input.fileName, media_type: input.mediaType, byte_size: input.bytes.byteLength, object_key: objectKey })}`;
              yield* sql`INSERT INTO imports ${sql.insert({ id: importId, source_file_id: sourceFileId, account_id: input.accountId, format, parser_version: "pending", workflow_instance_id: importId, status: "processing" })}`;
              return { sourceFileId, importId, existing: false, discardObject: false };
            }),
          );
          if (result.discardObject) yield* sources.delete(objectKey);
          if (!result.existing)
            yield* jobs
              .start({ importId, instanceId: importId })
              .pipe(
                Effect.catch((failure) =>
                  imports.fail({ importId, failure: { message: failure.message } }),
                ),
              );
          return {
            sourceFileId: result.sourceFileId,
            importId: result.importId,
            existing: result.existing,
          };
        },
        Effect.catchTags({
          SqlError: () => Effect.fail(databaseUnavailable()),
          SchemaError: () => Effect.fail(databaseUnavailable()),
          PlatformError: () => Effect.fail(databaseUnavailable()),
          R2Error: () => Effect.fail(databaseUnavailable()),
        }),
      );
      const download = Effect.fn("Uploads.download")(
        function* ({ sourceFileId }: typeof SourceFileInput.Type) {
          const rows =
            yield* sql`SELECT object_key AS "objectKey", file_name AS "fileName", bytes_available AS "bytesAvailable" FROM source_files WHERE id = ${sourceFileId}`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Download))),
            );
          const file = rows[0];
          if (!file || !file.bytesAvailable)
            return yield* new FinanceError({
              kind: "notFound",
              message: "Original file bytes are not available.",
            });
          const object = yield* sources.get(file.objectKey);
          if (!object)
            return yield* new FinanceError({
              kind: "unavailable",
              message: "The original file could not be read.",
            });
          return { fileName: file.fileName, object };
        },
        Effect.catchTags({
          SqlError: () => Effect.fail(databaseUnavailable()),
          SchemaError: () => Effect.fail(databaseUnavailable()),
          R2Error: () => Effect.fail(databaseUnavailable()),
        }),
      );
      return Uploads.of({ upload, download });
    }),
  );
}
