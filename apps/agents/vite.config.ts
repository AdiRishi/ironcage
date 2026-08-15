import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

const alchemyManagesCloudflare = process.env.ALCHEMY_CLOUDFLARE_VITE_INJECTED === "1";

export default defineConfig({
  plugins: [
    flue({ target: "cloudflare", providers: ["cloudflare"] }),
    alchemyManagesCloudflare ? null : cloudflare({ config: flueWorkerConfig() }),
  ],
});
