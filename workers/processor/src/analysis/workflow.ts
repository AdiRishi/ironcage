import type { Api } from "@repo/infra/api";
import { Workflows } from "alchemy/Cloudflare";
import { Effect } from "effect";

// Rebuilds facts one batch per step until none are left from an older derivation.
export const runFactsRebuild = (api: Pick<Api, "rebuildFactsBatch">) =>
  Effect.fn("FactsWorkflow.run")(function* () {
    for (let batch = 0; ; batch++) {
      const remaining = yield* Workflows.task(
        `batch-${batch}`,
        api.rebuildFactsBatch().pipe(Effect.orDie),
        { timeout: "5 minutes", retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      );
      if (remaining === 0) return;
    }
  });
