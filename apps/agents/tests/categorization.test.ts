import { CategorizationDispatch } from "@ironcage/contracts/schema";
import { BankTransactionId, CategoryId, RunId, Sha256, uuidV7From } from "@ironcage/domain";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import {
  categorizationInstructions,
  decodeCategorizationResult,
  type CategorizationAgentInput,
} from "../src/shared/categorization";

const random = new Uint8Array(16);
random[15] = 1;
const transactionId = Schema.decodeUnknownSync(BankTransactionId)(uuidV7From(1, random));
const categoryId = Schema.decodeUnknownSync(CategoryId)("01900000-0000-7000-8000-000000000002");
const runId = Schema.decodeUnknownSync(RunId)("6307a960-6640-54ff-8349-0269f07a93c1");
const digest = Schema.decodeUnknownSync(Sha256)("a".repeat(64));

const input: CategorizationAgentInput = {
  runId,
  configVersion: 1,
  bundleDigest: digest,
  batchIndex: 0,
  inputDigest: digest,
  model: "cloudflare/test-model",
  batch: [
    {
      transactionId,
      payee: "FRESH MART",
      narrative: "FRESH MART SAMPLETOWN AUS",
      amount: "-45.20",
      accountLabel: "Spending offset",
    },
  ],
  categories: [{ id: categoryId, name: "groceries", kind: "expense" }],
};

describe("categorization agent contract", () => {
  test("instructions preserve the complete recorded input and require the typed tool", () => {
    const instructions = categorizationInstructions(input);

    expect(instructions).toContain("submit_categorizations exactly once");
    expect(instructions).toContain(transactionId);
    expect(instructions).toContain(categoryId);
    expect(instructions).toContain("-45.20 AUD");
  });

  test("workflow parameters encode decoded money values to serializable strings", () => {
    const dispatch = Schema.decodeUnknownSync(CategorizationDispatch)({
      ...input,
      restart: false,
      attempt: 0,
    });
    const encoded = Schema.encodeSync(CategorizationDispatch)(dispatch);

    expect(encoded.batch[0]!.amount).toBe("-45.2");
    expect(structuredClone(encoded)).toEqual(encoded);
  });

  test("only a structured tool result crosses into the workflow", () => {
    const result = {
      suggestions: [{ transactionId, categoryId, rationale: "supermarket" }],
      gatewayLogId: "gateway-log-1",
    };

    expect(decodeCategorizationResult(result)).toEqual(result);
    expect(() => decodeCategorizationResult(undefined)).toThrow("Invalid type");
  });
});
