import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

// Alchemy sets this marker before injecting its Cloudflare Vite runtime. Loading
// the official plugin as well creates two competing Cloudflare environments.
const alchemyManagesCloudflare = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1";

export default defineConfig({
  plugins: [
    flue({ target: "cloudflare", providers: ["cloudflare"] }),
    alchemyManagesCloudflare ? null : cloudflare({ config: flueWorkerConfig() }),
  ],
});
