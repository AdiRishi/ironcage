import type { ModelProvider } from "@repo/contracts/finance";

// An estimate at uncached input rates, rounded up to the cent. It controls the
// usage warning; it is not the provider's invoice.
export function estimateModelCost({
  provider,
  inputTokens,
  outputTokens,
  searches,
}: {
  provider: ModelProvider;
  inputTokens: bigint | null;
  outputTokens: bigint | null;
  searches: number;
}) {
  if (inputTokens === null || outputTokens === null) return null;
  // Millionths of a microdollar, so the only rounding is up to the cent.
  const scaled =
    inputTokens * provider.inputMicrousdPerMillion +
    outputTokens * provider.outputMicrousdPerMillion +
    BigInt(searches) * provider.searchMicrousd * 1_000_000n;
  return { currency: "USD", minor: (scaled + 9_999_999_999n) / 10_000_000_000n };
}
