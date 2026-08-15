import { setProvider } from "@flue/runtime";
import {
  cloudflareBindingProvider,
  type CloudflareAIBinding,
} from "@flue/runtime/cloudflare/workers-ai";
import { env } from "cloudflare:workers";

const aiBinding: CloudflareAIBinding = {
  run: (modelId, inputs, options) =>
    env.AI.run(
      modelId,
      modelId === "openai/gpt-5.6-luna" && inputs.max_output_tokens === undefined
        ? { ...inputs, max_output_tokens: 8_192 }
        : inputs,
      options,
    ),
};

setProvider(
  cloudflareBindingProvider({
    binding: aiBinding,
    gateway: { id: env.AI_GATEWAY_ID },
  }),
);

export default {
  fetch(): Response {
    return Response.json({ worker: "ironcage-agents", status: "ok" });
  },
};
