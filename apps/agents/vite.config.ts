import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

// Alchemy sets this marker before injecting its Cloudflare Vite runtime. Loading
// the official plugin as well creates two competing Cloudflare environments.
const alchemyManagesCloudflare = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1";

// The Cloudflare runner evaluates Flue's virtual Worker before Vite's first
// dependency crawl finishes. Pre-bundle its entry points together so Vite does
// not replace shared optimized chunks while workerd is loading them.
const workerDependencies = [
  "@flue/runtime",
  "@flue/runtime/cloudflare/internal",
  "@flue/runtime/cloudflare/workers-ai",
  "@flue/runtime/internal",
  "effect",
  "effect/unstable/http",
  "effect/unstable/rpc",
  "effect/unstable/schema",
  "@ironcage/domain > uuid",
  "valibot",
];

export default defineConfig({
  environments: {
    ssr: {
      optimizeDeps: { include: workerDependencies },
    },
  },
  plugins: [
    flue({ target: "cloudflare", providers: ["cloudflare"] }),
    alchemyManagesCloudflare ? null : cloudflare({ config: flueWorkerConfig() }),
  ],
});
