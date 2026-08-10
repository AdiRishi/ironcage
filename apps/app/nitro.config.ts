import { defineConfig } from "nitro";

export default defineConfig({
  compatibilityDate: "2026-08-01",
  preset: "cloudflare-module",
  // `useRequest()` resolves through AsyncLocalStorage and throws without this.
  experimental: {
    asyncContext: true,
  },
  cloudflare: {
    deployConfig: true,
    nodeCompat: true,
    dev: {
      configPath: "wrangler.jsonc",
    },
  },
});
