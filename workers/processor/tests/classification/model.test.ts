import {
  CategoryId,
  ClassificationRunId,
  CommandId,
  EventId,
  type ClassificationBatch,
} from "@repo/contracts/finance";
import { MockLanguageModelV4 } from "ai/test";
import { Effect } from "effect";
import { expect, test } from "vitest";

import { classifyBatch } from "../../src/classification/model.ts";
const eventId = EventId.make("00000000-0000-4000-8000-000000000001");
const categoryId = CategoryId.make("00000000-0000-4000-8000-000000000002");
const batch: typeof ClassificationBatch.Type = {
  commandId: CommandId.make("00000000-0000-4000-8000-000000000003"),
  runId: ClassificationRunId.make("00000000-0000-4000-8000-000000000004"),
  items: [
    {
      eventId,
      eventVersion: 1,
      description: "Synthetic supermarket",
      role: "purchase",
      accountKind: "deposit",
      merchant: null,
    },
  ],
  categories: [{ id: categoryId, name: "Groceries", parentId: null, archived: false, version: 1 }],
  provider: {
    name: "Synthetic",
    model: "synthetic",
    inputMicrousdPerMillion: 270000n,
    outputMicrousdPerMillion: 850000n,
  },
};
const response = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 30, text: 30, reasoning: undefined },
      },
      warnings: [],
    }),
  });
test("valid category suggestions use the actual SDK structured-output validator and retain reported usage", async () => {
  const report = await Effect.runPromise(
    classifyBatch(
      response(JSON.stringify({ results: [{ eventId, categoryId, reason: "Grocery merchant." }] })),
      batch,
    ),
  );
  expect(report.status).toBe("success");
  expect(report.results).toEqual([{ eventId, categoryId, reason: "Grocery merchant." }]);
  expect(report.inputTokens).toBe(100n);
  expect(report.outputTokens).toBe(30n);
  expect(report.cost).toEqual({ currency: "USD", minor: 1n });
});
test("unknown categories and malformed output fail without losing reported usage", async () => {
  for (const text of [
    "not JSON",
    JSON.stringify({
      results: [
        {
          eventId,
          categoryId: "00000000-0000-4000-8000-000000000099",
          reason: "Unknown category.",
        },
      ],
    }),
  ]) {
    const report = await Effect.runPromise(classifyBatch(response(text), batch));
    expect(report.status).toBe("failed");
    expect(report.results).toEqual([]);
    expect(report.inputTokens).toBe(100n);
  }
});
test("provider failure reports unknown usage and preserves the manual path", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("Unavailable provider");
    },
  });
  const report = await Effect.runPromise(classifyBatch(model, batch));
  expect(report).toMatchObject({
    status: "failed",
    results: [],
    inputTokens: null,
    outputTokens: null,
    cost: null,
  });
  expect(report.failure).toContain("Manual categorization");
});
