import { EnrichmentBatch, EnrichmentInput, EnrichmentReport } from "@repo/contracts/finance";
import type { Api } from "@repo/infra/api";
import { Workflows } from "alchemy/Cloudflare";
import type { AI } from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

import { resolveAliases } from "./model.ts";

export const runEnrichment = (
  api: Pick<Api, "nextEnrichmentBatch" | "completeEnrichmentBatch" | "failEnrichment">,
  gateway: Pick<AI.QueryGatewayClient, "raw" | "id">,
) =>
  Effect.fn("EnrichmentWorkflow.run")(
    function* (input: typeof EnrichmentInput.Type) {
      let index = 0;
      while (true) {
        const batch = yield* Workflows.task(
          `read-${index}`,
          api
            .nextEnrichmentBatch(input)
            .pipe(Effect.flatMap(Schema.encodeEffect(EnrichmentBatch)), Effect.orDie),
        ).pipe(Effect.flatMap(Schema.decodeEffect(EnrichmentBatch)), Effect.orDie);
        if (batch.aliases.length === 0) return;
        const report = yield* Workflows.task(
          `resolve-${index}`,
          Effect.gen(function* () {
            const ai = yield* gateway.raw;
            const id = yield* gateway.id;
            return yield* resolveAliases(
              (body) =>
                ai.run(batch.provider.model, body, {
                  gateway: { id, skipCache: true, collectLog: false },
                }),
              batch,
            ).pipe(Effect.flatMap(Schema.encodeEffect(EnrichmentReport)), Effect.orDie);
          }),
          { timeout: "10 minutes", retries: { limit: 0, delay: "1 second", backoff: "constant" } },
        ).pipe(Effect.flatMap(Schema.decodeEffect(EnrichmentReport)), Effect.orDie);
        yield* Workflows.task(
          `record-${index}`,
          api
            .completeEnrichmentBatch({
              commandId: batch.commandId,
              runId: input.runId,
              aliasKeys: batch.aliases.map((alias) => alias.aliasKey),
              report,
            })
            .pipe(Effect.orDie),
        );
        if (report.status === "failed") return;
        index++;
      }
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchDefect(() =>
          Workflows.task(
            "record-failure",
            api
              .failEnrichment({
                runId: input.runId,
                message:
                  "Counterparty identification stopped. Check the model settings and usage, then run it again.",
              })
              .pipe(Effect.orDie),
          ),
        ),
      ),
  );
