import { PgClient } from "@effect/sql-pg";
import {
  FinanceError,
  Import,
  ImportInput,
  ImportJob,
  ListImports,
  RetryImport,
} from "@repo/contracts/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { Commands, databaseUnavailable } from "../database/commands.ts";
import { ImportJobs } from "../platform/services.ts";
import { ImportRepository } from "./repository.ts";

const Attempt = Schema.Struct({ instanceId: Schema.NullOr(Schema.String) });

export class Imports extends Context.Service<
  Imports,
  {
    readonly list: (
      input?: typeof ListImports.Type,
    ) => Effect.Effect<ReadonlyArray<Import>, FinanceError>;
    readonly get: (input: typeof ImportInput.Type) => Effect.Effect<Import, FinanceError>;
    readonly retry: (input: typeof RetryImport.Type) => Effect.Effect<Import, FinanceError>;
  }
>()("@repo/api/imports/Imports") {
  static readonly layer = Layer.effect(
    Imports,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const repository = yield* ImportRepository;
      const jobs = yield* ImportJobs;
      const commands = yield* Commands;
      const crypto = yield* Crypto.Crypto;
      const reconcile = Effect.fn("Imports.reconcile")(function* (item: Import) {
        if (item.status !== "processing") return item;
        const attempts =
          yield* sql`SELECT workflow_instance_id AS "instanceId" FROM imports WHERE id = ${item.id}`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Attempt))),
            Effect.mapError(databaseUnavailable),
          );
        const instanceId = attempts[0]?.instanceId;
        if (!instanceId) return item;
        const state = yield* jobs.status({ instanceId });
        if (
          state.status === "errored" ||
          state.status === "terminated" ||
          state.status === "complete"
        ) {
          yield* repository.fail({
            importId: item.id,
            instanceId,
            failure: {
              message:
                state.failure ?? "Processing stopped before publishing the file. Retry the import.",
            },
          });
          return yield* repository.get({ importId: item.id });
        }
        return item;
      });
      const get = Effect.fn("Imports.get")(function* (input: typeof ImportInput.Type) {
        return yield* reconcile(yield* repository.get(input));
      });
      const list = Effect.fn("Imports.list")(function* (input: typeof ListImports.Type = {}) {
        return yield* Effect.forEach(yield* repository.list(input), reconcile, { concurrency: 4 });
      });
      const retry = Effect.fn("Imports.retry")(function* (input: typeof RetryImport.Type) {
        const attempt = yield* commands.run({
          commandId: input.commandId,
          input: { operation: "retryImport", ...input },
          result: Schema.toCodecJson(ImportJob),
          execute: Effect.gen(function* () {
            const item = yield* repository.get(input);
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
            const source = yield* repository.source(input);
            if (!source.bytesAvailable)
              return yield* new FinanceError({
                kind: "conflict",
                message: "Reupload the original file before retrying.",
              });
            const instanceId = yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(databaseUnavailable),
            );
            yield* sql`UPDATE imports SET status = 'processing', failure = NULL, workflow_instance_id = ${instanceId}, version = version + 1, updated_at = now() WHERE id = ${input.importId}`;
            return { importId: input.importId, instanceId };
          }),
        });
        const active =
          yield* sql`SELECT id FROM imports WHERE id = ${attempt.importId} AND workflow_instance_id = ${attempt.instanceId} AND status = 'processing'`.pipe(
            Effect.mapError(databaseUnavailable),
          );
        if (active.length > 0)
          yield* jobs
            .start(attempt)
            .pipe(
              Effect.catch((error) =>
                repository.fail({ ...attempt, failure: { message: error.message } }),
              ),
            );
        return yield* repository.get(input);
      });
      return Imports.of({ list, get, retry });
    }),
  );
}
