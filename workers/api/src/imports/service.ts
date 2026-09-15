import { PgClient } from "@effect/sql-pg";
import {
  FailImport,
  FinanceError,
  Import,
  ImportInput,
  ImportJob,
  ImportPage,
  ImportSource,
  ListImports,
  RetryImport,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";
import type { Statement } from "effect/unstable/sql";

import { instant } from "../database/columns.ts";
import { Commands } from "../database/commands.ts";
import { toFinanceError } from "../database/failures.ts";
import { ImportJobs, ensureWorkflowStatus, workflowEnded } from "../platform/services.ts";

const pageSize = 100;
const StoredImport = Schema.Struct({
  ...Import.fields,
  instanceId: Schema.NullOr(Schema.String),
});

export class Imports extends Context.Service<
  Imports,
  {
    readonly list: (input?: typeof ListImports.Type) => Effect.Effect<ImportPage, FinanceError>;
    readonly get: (input: typeof ImportInput.Type) => Effect.Effect<Import, FinanceError>;
    readonly source: (
      input: typeof ImportInput.Type,
    ) => Effect.Effect<typeof ImportSource.Type, FinanceError>;
    readonly fail: (input: typeof FailImport.Type) => Effect.Effect<void, FinanceError>;
    readonly retry: (input: typeof RetryImport.Type) => Effect.Effect<Import, FinanceError>;
  }
>()("@repo/api/imports/Imports") {
  static readonly layer = Layer.effect(
    Imports,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const jobs = yield* ImportJobs;
      const commands = yield* Commands;
      const crypto = yield* Crypto.Crypto;
      const fields = sql`i.id, i.source_file_id AS "sourceFileId", i.account_id AS "accountId", s.file_name AS "fileName", i.format, i.status, i.summary, i.failure, i.version, ${instant(sql, sql("i.created_at"))} AS "createdAt", i.workflow_instance_id AS "instanceId"`;
      const read = (condition: Statement.Fragment) =>
        sql`SELECT ${fields} FROM imports i JOIN source_files s ON s.id = i.source_file_id WHERE ${condition} ORDER BY i.created_at DESC, i.id DESC LIMIT ${pageSize + 1}`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(StoredImport))),
        );
      const readOne = Effect.fn("Imports.readOne")(function* ({
        importId,
      }: typeof ImportInput.Type) {
        const [item] = yield* read(sql`i.id = ${importId}`);
        if (!item)
          return yield* new FinanceError({ kind: "notFound", message: "Import not found." });
        return item;
      });
      const fail = Effect.fn("Imports.fail")(function* ({
        importId,
        failure,
        instanceId,
      }: typeof FailImport.Type) {
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`SELECT pg_advisory_xact_lock(1)`;
            yield* sql`UPDATE imports SET status = 'failed', failure = ${sql.json(failure)}, version = version + 1, updated_at = now() WHERE id = ${importId} AND status = 'processing' AND workflow_instance_id = ${instanceId}`;
          }),
        );
      }, toFinanceError);
      // An import stays `processing` until publication reports, so a Workflow that
      // died without reporting is only visible through the platform's instance status.
      const refreshStatus = Effect.fn("Imports.refreshStatus")(function* ({
        instanceId,
        ...item
      }: typeof StoredImport.Type) {
        if (item.status !== "processing" || !instanceId) return item;
        const state = yield* ensureWorkflowStatus(
          jobs,
          { importId: item.id, instanceId },
          instanceId,
        );
        if (!state || !workflowEnded(state)) return item;
        yield* fail({
          importId: item.id,
          instanceId,
          failure: {
            message:
              state.failure ?? "Processing stopped before publishing the file. Retry the import.",
          },
        });
        return yield* get({ importId: item.id });
      });
      const get: Imports["Service"]["get"] = Effect.fn("Imports.get")(function* (
        input: typeof ImportInput.Type,
      ) {
        return yield* refreshStatus(yield* readOne(input));
      }, toFinanceError);
      const list = Effect.fn("Imports.list")(function* (input: typeof ListImports.Type = {}) {
        const stored = yield* read(
          input.cursor
            ? sql`(i.created_at, i.id) < (${input.cursor.createdAt}::timestamptz, ${input.cursor.id}::uuid)`
            : sql`true`,
        );
        const rows = yield* Effect.forEach(stored.slice(0, pageSize), refreshStatus, {
          concurrency: 4,
        });
        const last = rows.at(-1);
        return {
          rows,
          nextCursor:
            stored.length > pageSize && last ? { createdAt: last.createdAt, id: last.id } : null,
        };
      }, toFinanceError);
      const source = Effect.fn("Imports.source")(function* ({ importId }: typeof ImportInput.Type) {
        const [item] =
          yield* sql`SELECT i.id AS "importId", s.object_key AS "objectKey", i.format, COALESCE(a.currency, (SELECT reporting_currency FROM settings WHERE id = 1)) AS currency, s.bytes_available AS "bytesAvailable" FROM imports i JOIN source_files s ON s.id = i.source_file_id LEFT JOIN accounts a ON a.id = i.account_id WHERE i.id = ${importId}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ImportSource))),
          );
        if (!item)
          return yield* new FinanceError({ kind: "notFound", message: "Import not found." });
        return item;
      }, toFinanceError);
      const retry = Effect.fn("Imports.retry")(function* (input: typeof RetryImport.Type) {
        const attempt = yield* commands.run({
          commandId: input.commandId,
          input: { operation: "retryImport", ...input },
          result: Schema.toCodecJson(ImportJob),
          execute: Effect.gen(function* () {
            const item = yield* readOne(input);
            if (item.version !== input.expectedVersion)
              return yield* new FinanceError({
                kind: "stale",
                message: "This import changed. Refresh before retrying.",
              });
            if (item.status !== "failed")
              return yield* new FinanceError({
                kind: "conflict",
                message: "Only failed imports can be retried.",
              });
            const file = yield* source(input);
            if (!file.bytesAvailable)
              return yield* new FinanceError({
                kind: "conflict",
                message: "Reupload the original file before retrying.",
              });
            const instanceId = yield* crypto.randomUUIDv4;
            yield* sql`UPDATE imports SET status = 'processing', failure = NULL, workflow_instance_id = ${instanceId}, version = version + 1, updated_at = now() WHERE id = ${input.importId}`;
            return { importId: input.importId, instanceId };
          }),
        });
        // A repeated command returns the stored attempt; only the attempt that is still
        // current starts a Workflow, so an older duplicate cannot start a second one.
        const active =
          yield* sql`SELECT id FROM imports WHERE id = ${attempt.importId} AND workflow_instance_id = ${attempt.instanceId} AND status = 'processing'`;
        if (active.length > 0)
          yield* jobs
            .start(attempt)
            .pipe(
              Effect.catch((error) => fail({ ...attempt, failure: { message: error.message } })),
            );
        return yield* get(input);
      }, toFinanceError);
      return Imports.of({ list, get, source, fail, retry });
    }),
  );
}
