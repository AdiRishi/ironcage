import type { ModelProvider } from "@repo/contracts/finance";

// An estimate from the provider's list prices, rounded up to the cent. It controls
// the usage warning; it is not the provider's invoice. Cached input tokens are part
// of the input count and are priced at the cached rate.
export function estimateModelCost({
  provider,
  inputTokens,
  cachedInputTokens,
  outputTokens,
}: {
  provider: ModelProvider;
  inputTokens: bigint | null;
  cachedInputTokens: bigint;
  outputTokens: bigint | null;
}) {
  if (inputTokens === null || outputTokens === null) return null;
  const cached = cachedInputTokens < inputTokens ? cachedInputTokens : inputTokens;
  // Millionths of a microdollar, so the only rounding is up to the cent.
  const scaled =
    (inputTokens - cached) * provider.inputMicrousdPerMillion +
    cached * provider.cachedInputMicrousdPerMillion +
    outputTokens * provider.outputMicrousdPerMillion;
  return { currency: "USD", minor: (scaled + 9_999_999_999n) / 10_000_000_000n };
}
