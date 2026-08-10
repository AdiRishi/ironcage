import { defineConfig } from "nitro";

export default defineConfig({
  compatibilityDate: "2026-08-01",
  preset: "cloudflare-module",
  cloudflare: {
    deployConfig: true,
    nodeCompat: true,
    wrangler: {
      name: "ironcage-app",
      workers_dev: false,
      preview_urls: false,
      observability: {
        enabled: true,
        head_sampling_rate: 1,
      },
    },
  },
});
