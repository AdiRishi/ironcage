import type { CategorizationBatchItem, CategorizationCategory } from "@ironcage/contracts/schema";
import {
  Aud,
  BankTransactionId,
  CategoryId,
  deriveRunId,
  Sha256,
  uuidV7From,
} from "@ironcage/domain";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { runCategorization, type CategorizationRun } from "../src/categorization";

const transactionId = (seed: number) => {
  const random = new Uint8Array(16);
  random[15] = seed;
  return Schema.decodeUnknownSync(BankTransactionId)(uuidV7From(seed, random));
};

const groceries = Schema.decodeUnknownSync(CategoryId)("01900000-0000-7000-8000-000000000002");
const aud = Schema.decodeUnknownSync(Aud);
const digest = Schema.decodeUnknownSync(Sha256)("a".repeat(64));

const batch: CategorizationBatchItem[] = [
  {
    transactionId: transactionId(1),
    payee: "FRESH MART",
    narrative: "FRESH MART SAMPLETOWN AUS",
    amount: aud("-45.20"),
    accountLabel: "Spending offset",
  },
];
const categories: CategorizationCategory[] = [
  { id: groceries, name: "groceries", kind: "expense" },
];

const makeRun = async (): Promise<CategorizationRun> => ({
  runId: await deriveRunId("money.categorization", 1, `${digest}|0`),
  configVersion: 1,
  bundleDigest: digest,
  batchIndex: 0,
  batch,
  categories,
});

const goodAnswer = JSON.stringify({
  suggestions: [
    { transactionId: batch[0]!.transactionId, categoryId: groceries, rationale: "supermarket" },
  ],
});

describe("the categorization capability", () => {
  test("a valid answer becomes an Output message on the queue", async () => {
    const sent: unknown[] = [];
    const result = await runCategorization(await makeRun(), {
      model: "test-model",
      infer: () => Promise.resolve({ text: goodAnswer, gatewayLogId: "log-1" }),
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    });

    expect(result.accepted).toBe(true);
    expect(sent).toHaveLength(1);
    const message = sent[0] as { result: { _tag: string }; runId: string; trigger: unknown };
    expect(message.result._tag).toBe("Output");
    expect(message.trigger).toEqual({ _tag: "batch", bundleDigest: digest, batchIndex: 0 });
  });

  test("a malformed answer is retried and can recover", async () => {
    const sent: unknown[] = [];
    let calls = 0;
    await runCategorization(await makeRun(), {
      model: "test-model",
      infer: () => {
        calls += 1;
        return Promise.resolve({
          text: calls < 3 ? "sorry, here is prose" : goodAnswer,
          gatewayLogId: `log-${calls}`,
        });
      },
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    });

    expect(calls).toBe(3);
    expect((sent[0] as { result: { _tag: string } }).result._tag).toBe("Output");
    expect(
      (sent[0] as { decisionRecord: { gatewayLogIds: string[] } }).decisionRecord.gatewayLogIds,
    ).toEqual(["log-1", "log-2", "log-3"]);
  });

  test("an answer naming unknown ids exhausts the budget into a failed run", async () => {
    const sent: unknown[] = [];
    await runCategorization(await makeRun(), {
      model: "test-model",
      infer: () =>
        Promise.resolve({
          gatewayLogId: null,
          text: JSON.stringify({
            suggestions: [
              {
                transactionId: transactionId(99),
                categoryId: groceries,
                rationale: "made up",
              },
            ],
          }),
        }),
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    });

    const message = sent[0] as { result: { _tag: string; failure?: { reason: string } } };
    expect(message.result._tag).toBe("Failed");
    expect(message.result.failure?.reason).toBe("MalformedAnswer");
  });

  test("a model outage is a failed run, not a crash", async () => {
    const sent: unknown[] = [];
    await runCategorization(await makeRun(), {
      model: "test-model",
      infer: () => Promise.reject(new Error("gateway spend cap hit")),
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    });

    const message = sent[0] as { result: { _tag: string; failure?: { reason: string } } };
    expect(message.result._tag).toBe("Failed");
    expect(message.result.failure?.reason).toBe("InferenceFailed");
  });
});
