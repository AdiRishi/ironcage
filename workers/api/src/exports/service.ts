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

import { instant } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError, unavailable } from "../database/failures.ts";
import {
  ExportJobs,
  TemporaryExports,
  Sources,
  ensureWorkflowStatus,
  workflowEnded,
} from "../platform/services.ts";
import { writeArchive, textEntry, type ArchiveEntry } from "./archive.ts";
import { takeSnapshot } from "./snapshot.ts";

const make = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const commands = yield* Commands;
  const crypto = yield* Crypto.Crypto;
  const jobs = yield* ExportJobs;
  const bucket = yield* TemporaryExports;
  const sources = yield* Sources;
  const fields = sql`id, status, include_sources AS "includeSources", manifest, ${instant(sql, sql("expires_at"))} AS "expiresAt", failure, ${instant(sql, sql("requested_at"))} AS "requestedAt"`;
  const read = Effect.fn("Exports.read")(function* ({ exportId }: typeof ExportInput.Type) {
    const [record] = yield* sql`SELECT ${fields} FROM exports WHERE id = ${exportId}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ExportRecord))),
    );
    if (!record) return yield* new FinanceError({ kind: "notFound", message: "Export not found." });
    return record;
  }, toFinanceError);
  const fail = Effect.fn("Exports.fail")(function* ({ exportId }: typeof ExportInput.Type) {
    yield* sql`UPDATE exports SET status = 'failed', failure = ${sql.json({ message: "The export could not finish. Request a new export." })} WHERE id = ${exportId} AND status = 'processing'`;
  }, toFinanceError);
  const refreshStatus = Effect.fn("Exports.refreshStatus")(function* (record: ExportRecord) {
    if (record.status !== "processing") return record;
    const state = yield* ensureWorkflowStatus(jobs, { exportId: record.id }, record.id);
    if (!state || !workflowEnded(state)) return record;
    yield* fail({ exportId: record.id });
    return yield* read({ exportId: record.id });
  });
  const get = Effect.fn("Exports.get")(function* (input: typeof ExportInput.Type) {
    return yield* refreshStatus(yield* read(input));
  });
  const list = sql`SELECT ${fields} FROM exports ORDER BY requested_at DESC, id DESC`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ExportRecord))),
    toFinanceError,
    Effect.flatMap((rows) => Effect.forEach(rows, refreshStatus, { concurrency: 4 })),
    Effect.withSpan("Exports.list"),
  );
  const request = Effect.fn("Exports.request")(function* (input: typeof RequestExport.Type) {
    const result = yield* commands.run({
      commandId: input.commandId,
      input: { operation: "requestExport", ...input },
      result: Schema.toCodecJson(ExportInput),
      execute: Effect.gen(function* () {
        const exportId = ExportId.make(yield* crypto.randomUUIDv4);
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
    const snapshot = yield* takeSnapshot(sql);
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
        yield* Schema.encodeEffect(Schema.fromJsonString(ExportManifest))(manifest),
      ),
    );
    if (record.includeSources)
      for (const source of snapshot.sources) {
        if (!source.bytesAvailable) continue;
        entries.push({
          path: `sources/${source.id}`,
          body: Stream.unwrap(
            Effect.gen(function* () {
              const object = yield* sources.get(source.objectKey).pipe(toFinanceError);
              if (!object)
                return yield* new FinanceError({
                  kind: "unavailable",
                  message: "An original file could not be read.",
                });
              return object.body.pipe(Stream.mapError(() => unavailable()));
            }),
          ),
        });
      }
    const attemptId = yield* crypto.randomUUIDv4;
    const key = `exports/${record.id}/${attemptId}.zip`;
    yield* writeArchive(bucket, key, entries);
    yield* sql`UPDATE exports SET status = 'ready', manifest = ${sql.json(manifest)}, object_key = ${key}, expires_at = now() + interval '7 days', failure = NULL WHERE id = ${record.id} AND status = 'processing'`;
  }, toFinanceError);
  const download = Effect.fn("Exports.download")(function* ({ exportId }: typeof ExportInput.Type) {
    const [row] =
      yield* sql`SELECT object_key AS key FROM exports WHERE id = ${exportId} AND status = 'ready' AND expires_at > now()`.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ key: Schema.String }))),
        ),
      );
    if (!row)
      return yield* new FinanceError({
        kind: "notFound",
        message: "This export is not available. Request a new export.",
      });
    const object = yield* bucket.get(row.key);
    if (!object)
      return yield* new FinanceError({
        kind: "notFound",
        message: "This export has expired. Request a new export.",
      });
    return object;
  }, toFinanceError);
  return { request, list, get, generate, fail, download };
});

export class Exports extends Context.Service<Exports, Effect.Success<typeof make>>()(
  "@repo/api/exports/Exports",
) {
  static readonly layer = Layer.effect(Exports, make);
}
