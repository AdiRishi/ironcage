import { PgClient } from "@effect/sql-pg";
import {
  FinanceError,
  ImportId,
  Institution,
  SourceFileId,
  SourceFileInput,
  SourceFormat,
  UploadInput,
  UploadResult,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Encoding, Layer, Schema } from "effect";

import { toFinanceError } from "../database/failures.ts";
import { writeTransaction } from "../database/transactions.ts";
import { ImportJobs, Sources } from "../platform/services.ts";
import { Imports } from "./service.ts";

const StoredSource = Schema.Struct({
  sourceFileId: SourceFileId,
  importId: ImportId,
  bytesAvailable: Schema.Boolean,
});
const Download = Schema.Struct({
  objectKey: Schema.String,
  fileName: Schema.String,
  mediaType: Schema.String,
  bytesAvailable: Schema.Boolean,
});
export class Uploads extends Context.Service<
  Uploads,
  {
    readonly upload: (input: UploadInput) => Effect.Effect<typeof UploadResult.Type, FinanceError>;
    readonly download: (input: typeof SourceFileInput.Type) => Effect.Effect<
      {
        fileName: string;
        mediaType: string;
        object: NonNullable<Effect.Success<ReturnType<Sources["Service"]["get"]>>>;
      },
      FinanceError
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
      const imports = yield* Imports;
      const findBySha = (hash: string) =>
        sql`SELECT s.id AS "sourceFileId", i.id AS "importId", s.bytes_available AS "bytesAvailable" FROM source_files s JOIN imports i ON i.source_file_id = s.id WHERE s.sha256 = ${hash} ORDER BY i.created_at DESC LIMIT 1`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredSource))),
          Effect.map((rows) => rows[0]),
        );
      const upload = Effect.fn("Uploads.upload")(function* (input: UploadInput) {
        const extension = input.fileName.slice(input.fileName.lastIndexOf(".") + 1).toLowerCase();
        if (!Schema.is(SourceFormat)(extension))
          return yield* new FinanceError({
            kind: "invalid",
            message: "Choose a CSV, OFX or PDF file.",
          });
        const format = extension;
        if (format === "csv" && !input.accountId)
          return yield* new FinanceError({
            kind: "invalid",
            message: "Choose an account for this CSV.",
          });
        const mediaType = input.mediaType || "application/octet-stream";
        const hash = Encoding.encodeHex(yield* crypto.digest("SHA-256", input.bytes));
        const existing = yield* findBySha(hash);
        if (existing?.bytesAvailable) {
          yield* imports.get({ importId: existing.importId });
          return {
            sourceFileId: existing.sourceFileId,
            importId: existing.importId,
            existing: true,
          };
        }
        const uploadId = yield* crypto.randomUUIDv4;
        const objectKey = `sources/${hash}/${uploadId}`;
        yield* sources.put(objectKey, input.bytes, { httpMetadata: { contentType: mediaType } });
        const importId = ImportId.make(yield* crypto.randomUUIDv4);
        const sourceFileId = SourceFileId.make(yield* crypto.randomUUIDv4);
        const result = yield* writeTransaction(
          sql,
          Effect.gen(function* () {
            const found = yield* findBySha(hash);
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
              const [account] =
                yield* sql`SELECT institution FROM accounts WHERE id = ${input.accountId}`.pipe(
                  Effect.flatMap(
                    Schema.decodeUnknownEffect(
                      Schema.Array(Schema.Struct({ institution: Institution })),
                    ),
                  ),
                );
              if (!account)
                return yield* new FinanceError({ kind: "notFound", message: "Account not found." });
              if (account.institution !== input.institution)
                return yield* new FinanceError({
                  kind: "invalid",
                  message: "This account belongs to another bank.",
                });
            }
            yield* sql`INSERT INTO source_files ${sql.insert({ id: sourceFileId, sha256: hash, file_name: input.fileName, media_type: mediaType, byte_size: input.bytes.byteLength, object_key: objectKey })}`;
            yield* sql`INSERT INTO imports ${sql.insert({ id: importId, source_file_id: sourceFileId, account_id: input.accountId, format, institution: input.institution, parser_version: "pending", workflow_instance_id: importId, status: "processing" })}`;
            return { sourceFileId, importId, existing: false, discardObject: false };
          }),
        );
        if (result.discardObject) yield* sources.delete(objectKey);
        if (result.existing) yield* imports.get({ importId: result.importId });
        if (!result.existing)
          yield* jobs.start({ importId, instanceId: importId }).pipe(
            Effect.catch((failure) =>
              imports.fail({
                importId,
                instanceId: importId,
                failure: { message: failure.message },
              }),
            ),
          );
        return {
          sourceFileId: result.sourceFileId,
          importId: result.importId,
          existing: result.existing,
        };
      }, toFinanceError);
      const download = Effect.fn("Uploads.download")(function* ({
        sourceFileId,
      }: typeof SourceFileInput.Type) {
        const [file] =
          yield* sql`SELECT object_key AS "objectKey", file_name AS "fileName", media_type AS "mediaType", bytes_available AS "bytesAvailable" FROM source_files WHERE id = ${sourceFileId}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Download))),
          );
        if (!file?.bytesAvailable)
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
        return { fileName: file.fileName, mediaType: file.mediaType, object };
      }, toFinanceError);
      return Uploads.of({ upload, download });
    }),
  );
}
