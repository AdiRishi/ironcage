import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// workerd refuses to start with an unresolved binding, so the siblings have to
// exist. They throw rather than answer, so a unit test cannot quietly become an
// integration test.
const refusesEverything = `
  import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

  const refuse = () => {
    throw new Error("Stubbed sibling Worker: unit tests do not cross service bindings.");
  };

  export class DispatchApiEntrypoint extends WorkerEntrypoint { fetch() { refuse(); } }
  export class BacktestRunner extends DurableObject { ping() { refuse(); } }
  export default class extends WorkerEntrypoint { fetch() { refuse(); } }
`;

const stub = (name: string) => ({
  name,
  modules: true,
  script: refusesEverything,
  compatibilityDate: "2026-08-01",
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        workers: [
          stub("ironcage-agents"),
          { ...stub("ironcage-compute"), durableObjects: { BACKTEST: "BacktestRunner" } },
        ],
      },
    }),
  ],
});
