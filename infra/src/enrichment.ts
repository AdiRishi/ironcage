import type { ModelProvider } from "@repo/contracts/finance";
import * as Cloudflare from "alchemy/Cloudflare";

export const EnrichmentGateway = Cloudflare.AI.Gateway("EnrichmentGateway", {
  authentication: true,
  collectLogs: false,
  cacheTtl: null,
});

// Anthropic list prices for Claude Opus 5, billed through AI Gateway Unified Billing.
// Web search is priced per request.
export const enrichmentProvider = {
  name: "Anthropic through Cloudflare AI Gateway",
  model: "anthropic/claude-opus-5",
  inputMicrousdPerMillion: 5_000_000n,
  outputMicrousdPerMillion: 25_000_000n,
  searchMicrousd: 10_000n,
} satisfies ModelProvider;
