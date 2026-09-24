import { describe, expect, it } from "@effect/vitest";
import { CommandId, EnrichmentRunId, type EnrichmentBatch } from "@repo/contracts/finance";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { resolveAliases, type Runner } from "../../src/enrichment/model.ts";

const batch: typeof EnrichmentBatch.Type = {
  commandId: CommandId.make("00000000-0000-4000-8000-000000000001"),
  runId: EnrichmentRunId.make("00000000-0000-4000-8000-000000000002"),
  aliases: [
    {
      aliasKey: "SQ NEW CAFE",
      samples: ["SQ *NEW CAFE 0412"],
      channels: ["card"],
      directions: ["out"],
      accountKinds: ["deposit"],
      transactionCount: 3,
    },
  ],
  categories: [{ key: "food.coffee", name: "Coffee", parentKey: "food", tree: "spending" }],
  counterparties: [],
  examples: [],
  provider: {
    name: "Synthetic",
    model: "synthetic",
    inputMicrousdPerMillion: 150_000n,
    cachedInputMicrousdPerMillion: 30_000n,
    outputMicrousdPerMillion: 500_000n,
  },
};
const answer = {
  aliasKey: "SQ NEW CAFE",
  existingCounterpartyId: null,
  name: "New Cafe",
  kind: "business",
  brand: null,
  categoryKey: "food.coffee",
  defaultRole: null,
  confidence: 0.9,
  reason: "A cafe paid through Square.",
  proposedSubcategory: null,
};
const reply = (content: string | null, finishReason: "stop" | "length" = "stop") => ({
  id: "reply",
  object: "chat.completion",
  created: 0,
  model: "synthetic",
  choices: [
    {
      index: 0,
      finish_reason: finishReason,
      logprobs: null,
      message: { role: "assistant" as const, content, refusal: null },
    },
  ],
  usage: {
    prompt_tokens: 1_000_000,
    completion_tokens: 100_000,
    total_tokens: 1_100_000,
    prompt_tokens_details: { cached_tokens: 400_000 },
  },
});
const answering =
  (content: string | null, finishReason?: "stop" | "length"): Runner =>
  async () =>
    reply(content, finishReason);

describe("resolveAliases", () => {
  it.effect("returns the answer with usage priced at cached and uncached rates", () =>
    Effect.gen(function* () {
      let sent: Parameters<Runner>[0] | undefined;
      const report = yield* resolveAliases(async (input) => {
        sent = input;
        return reply(JSON.stringify({ results: [answer] }));
      }, batch);
      expect(report).toMatchObject({ status: "success", results: [answer], failure: null });
      expect(report.inputTokens).toBe(1_000_000n);
      expect(report.outputTokens).toBe(100_000n);
      // 0.6M uncached input at $0.15 + 0.4M cached at $0.03 + 0.1M output at $0.50 = $0.152
      expect(report.cost).toEqual({ currency: "USD", minor: 16n });
      const data = sent?.messages.find((message) => message.role === "user");
      expect(data?.content).toContain("SQ *NEW CAFE 0412");
      expect(JSON.stringify(data)).not.toMatch(/amount|minor/);
    }),
  );

  it.effect("fails a batch whose answer was cut off, keeping its usage", () =>
    Effect.gen(function* () {
      const report = yield* resolveAliases(answering('{"results":[', "length"), batch);
      expect(report).toMatchObject({
        status: "failed",
        results: [],
        failure: "The model ran out of output tokens before finishing this batch.",
      });
      expect(report.inputTokens).toBe(1_000_000n);
    }),
  );

  it.effect("rejects an answer that does not match the result schema, keeping its usage", () =>
    Effect.gen(function* () {
      const report = yield* resolveAliases(
        answering(JSON.stringify({ results: [{ aliasKey: 1 }] })),
        batch,
      );
      expect(report).toMatchObject({
        status: "failed",
        failure: "The model's answer did not match the expected format.",
      });
      expect(report.inputTokens).toBe(1_000_000n);
    }),
  );

  it.effect("retries a request that failed, then records unknown usage", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const fiber = yield* resolveAliases(async () => {
        attempts++;
        throw new Error("Capacity temporarily exceeded");
      }, batch).pipe(Effect.forkChild);
      yield* TestClock.adjust("10 minutes");
      const report = yield* Fiber.join(fiber);
      expect(attempts).toBe(4);
      expect(report).toMatchObject({
        status: "failed",
        inputTokens: null,
        cost: null,
        failure: "The model did not answer: Error: Capacity temporarily exceeded",
      });
    }),
  );
});
