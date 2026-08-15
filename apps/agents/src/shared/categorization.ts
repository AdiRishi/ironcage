import { CategorizationOutput } from "@ironcage/domain";
import { Schema } from "effect";
import * as v from "valibot";

const suggestionSchema = v.object({
  transactionId: v.string(),
  categoryId: v.string(),
  rationale: v.string(),
});

export const categorizationOutputSchema = v.object({
  suggestions: v.array(suggestionSchema),
});

export const categorizationResultSchema = v.object({
  suggestions: v.array(suggestionSchema),
  gatewayLogId: v.nullable(v.string()),
});

export const categorizationInitialDataSchema = v.object({
  runId: v.string(),
  configVersion: v.pipe(v.number(), v.integer()),
  bundleDigest: v.string(),
  batchIndex: v.pipe(v.number(), v.integer()),
  inputDigest: v.string(),
  model: v.pipe(v.string(), v.startsWith("cloudflare/")),
  batch: v.array(
    v.object({
      transactionId: v.string(),
      payee: v.string(),
      narrative: v.string(),
      amount: v.string(),
      accountLabel: v.string(),
    }),
  ),
  categories: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      kind: v.picklist(["expense", "income"]),
    }),
  ),
});
export type CategorizationAgentInput = v.InferOutput<typeof categorizationInitialDataSchema>;

export const categorizationInstructions = (input: CategorizationAgentInput): string => {
  const categories = input.categories
    .map((category) => `- ${category.id} "${category.name}" (${category.kind})`)
    .join("\n");
  const transactions = input.batch
    .map(
      (item) =>
        `- ${item.transactionId} | ${item.accountLabel} | ${item.amount} AUD | payee "${item.payee}" | narrative "${item.narrative}"`,
    )
    .join("\n");

  return [
    "Categorize Australian personal bank transactions.",
    "Call submit_categorizations exactly once. Include every transaction exactly once.",
    "Choose only category IDs from the offered list and keep each rationale to one short sentence.",
    "Negative amounts are spending and positive amounts are money in.",
    "",
    "Offered categories:",
    categories,
    "",
    "Transactions:",
    transactions,
  ].join("\n");
};

export const decodeCategorizationResult = v.parser(categorizationResultSchema);

export const toCategorizationOutput = Schema.decodeUnknownSync(CategorizationOutput);
