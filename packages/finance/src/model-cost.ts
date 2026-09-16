import type { ClassificationProvider } from "@repo/contracts/finance";
export function estimateModelCost(
  provider: typeof ClassificationProvider.Type,
  inputTokens: bigint | null,
  outputTokens: bigint | null,
) {
  if (inputTokens === null || outputTokens === null) return null;
  const numerator =
    inputTokens * provider.inputMicrousdPerMillion +
    outputTokens * provider.outputMicrousdPerMillion;
  return { currency: "USD", minor: (numerator + 9_999_999_999n) / 10_000_000_000n };
}
