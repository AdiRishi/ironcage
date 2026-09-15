import { ExportInput } from "@repo/contracts/finance";
import type { Api } from "@repo/infra/api";
import { Workflows } from "alchemy/Cloudflare";
import { Effect } from "effect";

export const runExport = (api: Pick<Api, "generateExport" | "failExport">) =>
  Effect.fn("ExportWorkflow.run")(
    function* (input: typeof ExportInput.Type) {
      yield* Workflows.task("export", api.generateExport(input).pipe(Effect.orDie), {
        timeout: "5 minutes",
        retries: { limit: 2, delay: "2 seconds", backoff: "exponential" },
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchDefect(() =>
          Workflows.task("record-failure", api.failExport(input).pipe(Effect.orDie)),
        ),
      ),
  );
