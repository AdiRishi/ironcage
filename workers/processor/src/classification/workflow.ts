import {
  ClassificationInput,
  ClassificationBatch,
  ClassificationReport,
} from "@repo/contracts/finance";
import type { Api } from "@repo/infra/api";
import { Workflows } from "alchemy/Cloudflare";
import type { AI } from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { createWorkersAI } from "workers-ai-provider";

import { classifyBatch } from "./model.ts";
export const runClassification = (
  api: Pick<Api, "nextClassificationBatch" | "completeClassificationBatch" | "failClassification">,
  gateway: Pick<AI.QueryGatewayClient, "raw" | "id">,
) =>
  Effect.fn("ClassificationWorkflow.run")(
    function* (input: typeof ClassificationInput.Type) {
      let index = 0;
      while (true) {
        const batch = yield* Workflows.task(
          `read-${index}`,
          api
            .nextClassificationBatch(input)
            .pipe(Effect.flatMap(Schema.encodeEffect(ClassificationBatch)), Effect.orDie),
        ).pipe(Effect.flatMap(Schema.decodeEffect(ClassificationBatch)), Effect.orDie);
        if (batch.items.length === 0) return;
        const report = yield* Workflows.task(
          `suggest-${index}`,
          Effect.gen(function* () {
            const workersai = createWorkersAI({ binding: yield* gateway.raw });
            const model = workersai(batch.provider.model, {
              gateway: { id: yield* gateway.id, collectLog: false, skipCache: true },
            });
            return yield* classifyBatch(model, batch).pipe(
              Effect.flatMap(Schema.encodeEffect(ClassificationReport)),
              Effect.orDie,
            );
          }),
          { timeout: "3 minutes", retries: { limit: 0, delay: "1 second", backoff: "constant" } },
        ).pipe(Effect.flatMap(Schema.decodeEffect(ClassificationReport)), Effect.orDie);
        yield* Workflows.task(
          `record-${index}`,
          api
            .completeClassificationBatch({
              commandId: batch.commandId,
              runId: input.runId,
              expectedVersions: batch.items.map((item) => ({
                eventId: item.eventId,
                version: item.eventVersion,
              })),
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
              .failClassification({
                runId: input.runId,
                message:
                  "Suggestion processing stopped. Review model settings and usage, then request suggestions again.",
              })
              .pipe(Effect.orDie),
          ),
        ),
      ),
  );
