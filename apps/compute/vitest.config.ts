import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        name: "ironcage-compute",
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          BACKTEST: "BacktestRunner",
        },
        r2Buckets: ["BLOBS"],
      },
    }),
  ],
});
