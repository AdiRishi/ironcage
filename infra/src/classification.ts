import type { ClassificationProvider } from "@repo/contracts/finance";
import * as Cloudflare from "alchemy/Cloudflare";

export const ClassificationGateway = Cloudflare.AI.Gateway("ClassificationGateway", {
  authentication: true,
  collectLogs: false,
  cacheTtl: null,
});

export const classificationProvider = {
  name: "Cloudflare Workers AI",
  model: "@cf/zai-org/glm-5.3-flash",
  inputMicrousdPerMillion: 150000n,
  outputMicrousdPerMillion: 500000n,
} satisfies typeof ClassificationProvider.Type;
