import {
  CapabilityRunMessage,
  categorizationCapability,
  CategorizationOutput,
  type CategorizationBatchItem,
  type CategorizationCategory,
  type DecisionRecordBody,
  type FailureDetail,
} from "@ironcage/contracts/schema";
import type { RunId, Sha256 } from "@ironcage/domain";
import { BigDecimal, Schema } from "effect";

/**
 * Money's transaction categorization — the system's first batch capability.
 * The model answers one import batch; the run's only exit is the
 * decision-records queue, where core re-validates everything. A malformed
 * answer after the retry budget is a failed run, and the failure itself is
 * the delivery.
 */
export interface CategorizationRun {
  readonly runId: RunId;
  readonly configVersion: number;
  readonly bundleDigest: Sha256;
  readonly batchIndex: number;
  readonly batch: readonly CategorizationBatchItem[];
  readonly categories: readonly CategorizationCategory[];
}

export interface CategorizationDeps {
  /** One model call through the AI Gateway; the answer is raw text. */
  readonly infer: (prompt: string) => Promise<string>;
  readonly send: (message: unknown) => Promise<unknown>;
  readonly model: string;
}

/** Malformed answers are retried this many times beyond the first attempt. */
const retryBudget = 2;

const prompt = (run: CategorizationRun): string => {
  const categories = run.categories
    .map((category) => `- ${category.id} "${category.name}" (${category.kind})`)
    .join("\n");
  const transactions = run.batch
    .map(
      (item) =>
        `- id ${item.transactionId} | account "${item.accountLabel}" | amount ${BigDecimal.format(item.amount)} | payee "${item.payee}" | narrative "${item.narrative}"`,
    )
    .join("\n");

  return [
    "You categorize Australian personal bank transactions.",
    "Choose the best category for each transaction from this list and no other:",
    categories,
    "",
    "Transactions (amounts are AUD; negative is spending, positive is money in):",
    transactions,
    "",
    'Answer with ONLY a JSON object of the shape {"suggestions":[{"transactionId":"...","categoryId":"...","rationale":"..."}]}.',
    "Every transactionId must come from the list above, every categoryId from the category list.",
    "Keep each rationale to one short sentence. Do not wrap the JSON in markdown.",
  ].join("\n");
};

const parseAnswer = (
  run: CategorizationRun,
  answer: string,
): CategorizationOutput | { readonly invalid: string } => {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return { invalid: "no JSON object in the answer" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return { invalid: "the answer is not valid JSON" };
  }

  let decoded: CategorizationOutput;
  try {
    decoded = Schema.decodeUnknownSync(CategorizationOutput)(parsed);
  } catch {
    return { invalid: "the answer does not match the output schema" };
  }

  const transactionIds = new Set(run.batch.map((item) => item.transactionId));
  const categoryIds = new Set(run.categories.map((category) => category.id));
  for (const suggestion of decoded.suggestions) {
    if (!transactionIds.has(suggestion.transactionId)) {
      return { invalid: `unknown transaction ${suggestion.transactionId}` };
    }
    if (!categoryIds.has(suggestion.categoryId)) {
      return { invalid: `unknown category ${suggestion.categoryId}` };
    }
  }

  return decoded;
};

const validateOwnMessage = Schema.decodeUnknownSync(CapabilityRunMessage);

export const runCategorization = async (
  run: CategorizationRun,
  deps: CategorizationDeps,
): Promise<{ readonly accepted: boolean }> => {
  let output: CategorizationOutput | null = null;
  let failure: FailureDetail | null = null;

  for (let attempt = 0; attempt <= retryBudget && output === null; attempt += 1) {
    let answer: string;
    try {
      answer = await deps.infer(prompt(run));
    } catch (error) {
      failure = {
        reason: "InferenceFailed",
        detail: error instanceof Error ? error.message : "the model call failed",
      };
      break;
    }
    const parsed = parseAnswer(run, answer);
    if ("invalid" in parsed) {
      failure = { reason: "MalformedAnswer", detail: parsed.invalid };
    } else {
      output = parsed;
      failure = null;
    }
  }

  const decisionRecord: DecisionRecordBody = {
    asked: `categorize ${run.batch.length} bank transactions (batch ${run.batchIndex} of bundle ${run.bundleDigest.slice(0, 12)}…)`,
    inputsSummary: {
      batchSize: run.batch.length,
      categories: run.categories.length,
      bundleDigest: run.bundleDigest,
      batchIndex: run.batchIndex,
    },
    decided: output === null ? { failed: failure } : { suggestions: output.suggestions.length },
    rationale:
      output === null
        ? `run failed: ${failure?.detail ?? "unknown"}`
        : `suggested categories for ${output.suggestions.length} of ${run.batch.length} transactions`,
    model: deps.model,
    gatewayLogIds: [],
    otelTraceId: crypto.randomUUID(),
    otelParentSpanIds: [],
  };

  // The wire form directly: every field is already JSON-shaped, and decoding
  // our own message before sending catches producer drift at the source.
  const message = {
    runId: run.runId,
    capability: categorizationCapability.name,
    sleeveId: null,
    configVersion: run.configVersion,
    trigger: { _tag: "batch", bundleDigest: run.bundleDigest, batchIndex: run.batchIndex },
    producedAt: new Date().toISOString(),
    result:
      output === null
        ? { _tag: "Failed", failure: failure ?? { reason: "Unknown", detail: "no answer" } }
        : { _tag: "Output", output },
    decisionRecord,
  };
  validateOwnMessage(message);

  await deps.send(message);
  return { accepted: true };
};
