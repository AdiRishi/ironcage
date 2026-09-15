import { PgClient } from "@effect/sql-pg";
import {
  ExportId,
  ExportInput,
  ExportManifest,
  ExportRecord,
  FinanceError,
  RequestExport,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema, Stream } from "effect";

import { Commands, databaseUnavailable } from "../database/commands.ts";
import { ExportJobs, TemporaryExports, Sources } from "../platform/services.ts";
import { writeArchive, textEntry, type ArchiveEntry } from "./archive.ts";
import { takeSnapshot } from "./snapshot.ts";

const make = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const commands = yield* Commands;
  const crypto = yield* Crypto.Crypto;
  const jobs = yield* ExportJobs;
  const bucket = yield* TemporaryExports;
  const sources = yield* Sources;
  const fields = sql`id, status, include_sources AS "includeSources", manifest, to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "expiresAt", failure, to_char(requested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "requestedAt"`;
  const read = Effect.fn("Exports.read")(function* ({ exportId }: typeof ExportInput.Type) {
    const rows = yield* sql`SELECT ${fields} FROM exports WHERE id = ${exportId}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ExportRecord))),
      Effect.mapError(databaseUnavailable),
    );
    const record = rows[0];
    if (!record) return yield* new FinanceError({ kind: "notFound", message: "Export not found." });
    return record;
  });
  const fail = Effect.fn("Exports.fail")(function* ({ exportId }: typeof ExportInput.Type) {
    yield* sql`UPDATE exports SET status = 'failed', failure = ${sql.json({ message: "The export could not finish. Request a new export." })} WHERE id = ${exportId} AND status = 'processing'`.pipe(
      Effect.mapError(databaseUnavailable),
    );
  });
  const reconcile = Effect.fn("Exports.reconcile")(function* (record: ExportRecord) {
    if (record.status !== "processing") return record;
    const state = yield* jobs.status({ instanceId: record.id });
    if (
      state.status === "errored" ||
      state.status === "terminated" ||
      state.status === "complete"
    ) {
      yield* fail({ exportId: record.id });
      return yield* read({ exportId: record.id });
    }
    return record;
  });
  const get = Effect.fn("Exports.get")(function* (input: typeof ExportInput.Type) {
    return yield* reconcile(yield* read(input));
  });
  const list = Effect.gen(function* () {
    const rows = yield* sql`SELECT ${fields} FROM exports ORDER BY requested_at DESC, id DESC`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ExportRecord))),
      Effect.mapError(databaseUnavailable),
    );
    return yield* Effect.forEach(rows, reconcile, { concurrency: 4 });
  }).pipe(Effect.withSpan("Exports.list"));
  const request = Effect.fn("Exports.request")(function* (input: typeof RequestExport.Type) {
    const result = yield* commands.run({
      commandId: input.commandId,
      input: { operation: "requestExport", ...input },
      result: Schema.toCodecJson(ExportInput),
      execute: Effect.gen(function* () {
        const exportId = ExportId.make(
          yield* crypto.randomUUIDv4.pipe(Effect.mapError(databaseUnavailable)),
        );
        yield* sql`INSERT INTO exports (id, status, include_sources) VALUES (${exportId}, 'processing', ${input.includeSources})`;
        return { exportId };
      }),
    });
    if ((yield* read(result)).status === "processing")
      yield* jobs.start(result).pipe(Effect.catch(() => fail(result)));
    return yield* read(result);
  });
  const generate = Effect.fn("Exports.generate")(function* (input: typeof ExportInput.Type) {
    const record = yield* read(input);
    if (record.status !== "processing") return;
    const snapshot = yield* takeSnapshot().pipe(
      Effect.provideService(PgClient.PgClient, sql),
      Effect.mapError(databaseUnavailable),
    );
    const manifest = ExportManifest.make({
      formatVersion: 1,
      snapshotAt: snapshot.snapshotAt,
      includeSources: record.includeSources,
      tables: snapshot.tables.map(({ name, path, count }) => ({ name, path, count })),
      sources: snapshot.sources.map((source) => ({
        id: source.id,
        fileName: source.fileName,
        bytesAvailable: source.bytesAvailable,
        path: record.includeSources && source.bytesAvailable ? `sources/${source.id}` : null,
      })),
    });
    const entries: ArchiveEntry[] = snapshot.tables.map(({ path, json }) => textEntry(path, json));
    entries.push(
      textEntry(
        "manifest.json",
        yield* Schema.encodeEffect(Schema.fromJsonString(ExportManifest))(manifest).pipe(
          Effect.mapError(databaseUnavailable),
        ),
      ),
    );
    if (record.includeSources)
      for (const source of snapshot.sources) {
        if (!source.bytesAvailable) continue;
        entries.push({
          path: `sources/${source.id}`,
          body: Stream.unwrap(
            Effect.gen(function* () {
              const object = yield* sources
                .get(source.objectKey)
                .pipe(Effect.mapError(databaseUnavailable));
              if (!object)
                return yield* new FinanceError({
                  kind: "unavailable",
                  message: "An original file could not be read.",
                });
              return object.body.pipe(Stream.mapError(databaseUnavailable));
            }),
          ),
        });
      }
    const attemptId = yield* crypto.randomUUIDv4.pipe(Effect.mapError(databaseUnavailable));
    const key = `exports/${record.id}/${attemptId}.zip`;
    yield* writeArchive(bucket, key, entries);
    yield* sql`UPDATE exports SET status = 'ready', manifest = ${sql.json(manifest)}, object_key = ${key}, expires_at = now() + interval '7 days', failure = NULL WHERE id = ${record.id} AND status = 'processing'`.pipe(
      Effect.mapError(databaseUnavailable),
    );
  });
  const download = Effect.fn("Exports.download")(function* ({ exportId }: typeof ExportInput.Type) {
    const rows =
      yield* sql`SELECT object_key AS key FROM exports WHERE id = ${exportId} AND status = 'ready' AND expires_at > now()`.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ key: Schema.String }))),
        ),
        Effect.mapError(databaseUnavailable),
      );
    const row = rows[0];
    if (!row)
      return yield* new FinanceError({
        kind: "notFound",
        message: "This export is not available. Request a new export.",
      });
    const object = yield* bucket.get(row.key).pipe(Effect.mapError(databaseUnavailable));
    if (!object)
      return yield* new FinanceError({
        kind: "notFound",
        message: "This export has expired. Request a new export.",
      });
    return object;
  });
  return { request, list, get, generate, fail, download };
});

export class Exports extends Context.Service<Exports, Effect.Success<typeof make>>()(
  "@repo/api/Exports",
) {
  static readonly layer = Layer.effect(Exports, make);
}
