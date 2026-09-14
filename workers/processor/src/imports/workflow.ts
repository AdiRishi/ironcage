import { FinanceError, ImportInput, ParsedFile } from "@repo/contracts/finance";
import type { Api } from "@repo/infra/api";
import { Workflows } from "alchemy/Cloudflare";
import type { ReadBucketClient } from "alchemy/Cloudflare/R2";
import { Effect, Schema } from "effect";

import { parseCsv } from "./csv.ts";

export const runImport = (
  api: Pick<Api, "getImportSource" | "publishImport" | "failImport">,
  sources: ReadBucketClient,
) =>
  Effect.fn("ImportWorkflow.run")(
    function* (input: typeof ImportInput.Type) {
      const parsed = yield* Workflows.task(
        "parse",
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
          if (source.format !== "csv")
            return yield* new FinanceError({
              kind: "invalid",
              message: "This file format is not supported by the installed parser.",
            });
          const result = yield* parseCsv(bytes, source.currency);
          return yield* Schema.encodeEffect(ParsedFile)(result);
        }).pipe(Effect.orDie),
        { timeout: "1 minute", retries: { limit: 2, delay: "2 seconds", backoff: "exponential" } },
      );
      return yield* Workflows.task(
        "publish",
        Effect.gen(function* () {
          const file = yield* Schema.decodeUnknownEffect(ParsedFile)(parsed);
          return yield* api.publishImport({ importId: input.importId, ...file });
        }).pipe(Effect.orDie),
        { timeout: "1 minute", retries: { limit: 2, delay: "2 seconds", backoff: "exponential" } },
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchCause(() =>
          Workflows.task(
            "record-failure",
            api
              .failImport({
                ...input,
                failure: {
                  message: "The import could not finish. Retry processing the original file.",
                },
              })
              .pipe(Effect.orDie),
          ),
        ),
      ),
  );
