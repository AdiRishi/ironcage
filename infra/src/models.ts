import { analystModel, enrichmentModel, type ModelProvider } from "@repo/contracts/finance";

// Workers AI list prices, used to estimate what each call cost:
// https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/
const workersAiPrices = {
  "@cf/zai-org/glm-5.3-flash": {
    inputMicrousdPerMillion: 150_000n,
    cachedInputMicrousdPerMillion: 30_000n,
    outputMicrousdPerMillion: 500_000n,
  },
};

const workersAi = (model: keyof typeof workersAiPrices) =>
  ({ name: "Cloudflare Workers AI", model, ...workersAiPrices[model] }) satisfies ModelProvider;

export const modelProviders = {
  enrichment: workersAi(enrichmentModel),
  analyst: workersAi(analystModel),
};
