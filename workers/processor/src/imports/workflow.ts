import { FinanceError, ImportJob } from "@repo/contracts/finance";
import type { Api } from "@repo/infra/api";
import { Workflows } from "alchemy/Cloudflare";
import type { ReadBucketClient } from "alchemy/Cloudflare/R2";
import { Effect } from "effect";

import { parseCsv } from "./csv.ts";
import { parseOfx } from "./ofx.ts";
import { parsePdf } from "./pdf/index.ts";

export const runImport = (
  api: Pick<Api, "getImportSource" | "publishImport" | "failImport">,
  sources: ReadBucketClient,
) =>
  Effect.fn("ImportWorkflow.run")(
    function* (input: typeof ImportJob.Type) {
      return yield* Workflows.task(
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
          const result =
            source.format === "csv"
              ? yield* parseCsv(bytes, source.currency)
              : source.format === "ofx"
                ? yield* parseOfx(bytes)
                : yield* parsePdf(bytes);
          return yield* api.publishImport({ importId: input.importId, ...result });
        }).pipe(Effect.orDie),
        { timeout: "1 minute", retries: { limit: 2, delay: "2 seconds", backoff: "exponential" } },
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchDefect(() =>
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
