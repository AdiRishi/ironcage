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
        // The extractor wasm must arrive as a compiled module for initSync,
        // not as an instantiated WebAssembly ES module.
        modulesRules: [{ type: "CompiledWasm", include: ["**/*.wasm"] }],
        durableObjects: {
          BACKTEST: "BacktestRunner",
          STATEMENT_EXTRACTION: "StatementExtractor",
        },
        r2Buckets: ["BLOBS"],
      },
    }),
  ],
});
