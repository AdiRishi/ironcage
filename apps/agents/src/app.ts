import { setProvider } from "@flue/runtime";
import { cloudflareBindingProvider } from "@flue/runtime/cloudflare/workers-ai";
import { env } from "cloudflare:workers";

setProvider(
  cloudflareBindingProvider({
    binding: env.AI,
    gateway: { id: env.AI_GATEWAY_ID },
  }),
);

export default {
  fetch(): Response {
    return Response.json({ worker: "ironcage-agents", status: "ok" });
  },
};
