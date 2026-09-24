import { enrichmentModel, type ModelProvider } from "@repo/contracts/finance";
import * as Cloudflare from "alchemy/Cloudflare";

export const EnrichmentGateway = Cloudflare.AI.Gateway("EnrichmentGateway", {
  authentication: true,
  collectLogs: false,
  cacheTtl: null,
});

// Workers AI list prices for GLM-5.3-Flash:
// https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/
export const enrichmentProvider = {
  name: "Cloudflare Workers AI",
  model: enrichmentModel,
  inputMicrousdPerMillion: 150_000n,
  cachedInputMicrousdPerMillion: 30_000n,
  outputMicrousdPerMillion: 500_000n,
} satisfies ModelProvider;
