import { describe, expect, it } from "@effect/vitest";
import { CommandId, EnrichmentRunId, type EnrichmentBatch } from "@repo/contracts/finance";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { resolveAliases } from "../../src/enrichment/model.ts";

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
    inputMicrousdPerMillion: 5_000_000n,
    outputMicrousdPerMillion: 25_000_000n,
    searchMicrousd: 10_000n,
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
const reply = (
  stop: string,
  content: object[],
  usage: { server_tool_use?: { web_search_requests: number } } = {},
) => ({
  stop_reason: stop,
  content,
  usage: { input_tokens: 100_000, output_tokens: 10_000, ...usage },
});

describe("resolveAliases", () => {
  it.effect("resumes a turn paused by web search and totals usage across both requests", () =>
    Effect.gen(function* () {
      const sent: unknown[] = [];
      const replies = [
        reply(
          "pause_turn",
          [{ type: "server_tool_use", id: "s1", name: "web_search", input: {} }],
          {
            server_tool_use: { web_search_requests: 2 },
          },
        ),
        reply("end_turn", [{ type: "text", text: JSON.stringify({ results: [answer] }) }]),
      ];
      const report = yield* resolveAliases(async (body) => {
        sent.push(structuredClone(body.messages));
        const next = replies.shift();
        if (!next) throw new Error("No reply left");
        return next;
      }, batch);
      expect(report).toMatchObject({ status: "success", results: [answer], searches: 2 });
      expect(report.inputTokens).toBe(200_000n);
      expect(report.outputTokens).toBe(20_000n);
      // 0.2M input at $5 + 0.02M output at $25 + two searches at $0.01 = $1.52
      expect(report.cost).toEqual({ currency: "USD", minor: 152n });
      expect(sent[1]).toMatchObject([{ role: "user" }, { role: "assistant" }]);
      expect(JSON.stringify(sent[0])).not.toMatch(/amount|minor/);
    }),
  );

  it.effect("reports a refusal as a failed batch with its usage", () =>
    Effect.gen(function* () {
      const report = yield* resolveAliases(async () => reply("refusal", []), batch);
      expect(report).toMatchObject({
        status: "failed",
        results: [],
        failure: "The model declined this batch. Its aliases stay unresolved.",
      });
      expect(report.inputTokens).toBe(100_000n);
    }),
  );

  it.effect("retries a failing request, then records unknown usage", () =>
    Effect.gen(function* () {
      let attempts = 0;
      const fiber = yield* resolveAliases(async () => {
        attempts++;
        throw new Error("Gateway unavailable");
      }, batch).pipe(Effect.forkChild);
      yield* TestClock.adjust("10 minutes");
      const report = yield* Fiber.join(fiber);
      expect(attempts).toBe(4);
      expect(report).toMatchObject({ status: "failed", inputTokens: null, cost: null });
    }),
  );

  it.effect("retries a reply that is an error body, then uses the next answer", () =>
    Effect.gen(function* () {
      const replies: object[] = [
        { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        reply("end_turn", [{ type: "text", text: JSON.stringify({ results: [answer] }) }]),
      ];
      const fiber = yield* resolveAliases(async () => {
        const next = replies.shift();
        if (!next) throw new Error("No reply left");
        return next;
      }, batch).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 minute");
      expect(yield* Fiber.join(fiber)).toMatchObject({ status: "success", results: [answer] });
    }),
  );

  it.effect("names the provider's error when every attempt returns one", () =>
    Effect.gen(function* () {
      const fiber = yield* resolveAliases(
        async () => ({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
        batch,
      ).pipe(Effect.forkChild);
      yield* TestClock.adjust("10 minutes");
      expect(yield* Fiber.join(fiber)).toMatchObject({
        status: "failed",
        inputTokens: null,
        failure: "The provider did not answer: overloaded_error: Overloaded",
      });
    }),
  );

  it.effect("rejects output that does not match the result schema", () =>
    Effect.gen(function* () {
      const report = yield* resolveAliases(
        async () =>
          reply("end_turn", [
            { type: "text", text: JSON.stringify({ results: [{ aliasKey: 1 }] }) },
          ]),
        batch,
      );
      expect(report).toMatchObject({ status: "failed", results: [] });
    }),
  );
});
