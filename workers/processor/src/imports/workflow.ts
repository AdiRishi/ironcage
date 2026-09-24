import { FinanceError, ImportJob } from "@repo/contracts/finance";
import type { Api } from "@repo/infra/api";
import { Workflows } from "alchemy/Cloudflare";
import type { ReadBucketClient } from "alchemy/Cloudflare/R2";
import { Effect, Schema } from "effect";

import { sourceParsers } from "./index.ts";

export const runImport = (
  api: Pick<Api, "getImportSource" | "publishImport" | "failImport">,
  sources: ReadBucketClient,
) => {
  const recordFailure = (input: typeof ImportJob.Type, message: string) =>
    Workflows.task(
      "record-failure",
      api.failImport({ ...input, failure: { message } }).pipe(Effect.orDie),
    );
  return Effect.fn("ImportWorkflow.run")(
    function* (input: typeof ImportJob.Type) {
      // Only `unavailable` is worth the platform's retries; any other failure is a
      // property of the file and is recorded as the import's failure message.
      const failure = yield* Workflows.task(
        "import",
        Effect.gen(function* () {
          const source = yield* api.getImportSource(input);
          if (!source.bytesAvailable)
            return yield* new FinanceError({
              kind: "notFound",
              message: "The original file bytes were removed. Reupload the file.",
            });
          const object = yield* sources.get(source.objectKey);
          if (!object)
            return yield* new FinanceError({
              kind: "unavailable",
              message: "The original file could not be read.",
            });
          const bytes = yield* object.bytes();
          const result = yield* sourceParsers[source.institution][source.format]({
            bytes,
            currency: source.currency,
          });
          yield* api.publishImport({ importId: input.importId, ...result });
          return null;
        }).pipe(
          // A FinanceError from the API arrives over RPC as a plain object, so it is
          // matched by its fields rather than its class.
          Effect.catchIf(
            (error) =>
              Schema.is(Schema.Struct(FinanceError.fields))(error) && error.kind !== "unavailable",
            (error) => Effect.succeed(error.message),
          ),
          Effect.orDie,
        ),
        { timeout: "1 minute", retries: { limit: 2, delay: "2 seconds", backoff: "exponential" } },
      );
      if (failure !== null) yield* recordFailure(input, failure);
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchDefect(() =>
          recordFailure(input, "The import could not finish. Retry processing the original file."),
        ),
      ),
  );
};
