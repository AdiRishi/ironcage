import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// workerd refuses to start with an unresolved binding, so core has to exist. It
// throws rather than answer, so a unit test cannot quietly become an
// integration test.
const refusesEverything = `
  import { WorkerEntrypoint } from "cloudflare:workers";

  const refuse = () => {
    throw new Error("Stubbed sibling Worker: unit tests do not cross service bindings.");
  };

  export class AgentReadApiEntrypoint extends WorkerEntrypoint { fetch() { refuse(); } }
  export default class extends WorkerEntrypoint { fetch() { refuse(); } }
`;

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        name: "ironcage-agents",
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        serviceBindings: {
          CORE: { name: "ironcage-core", entrypoint: "AgentReadApiEntrypoint" },
        },
        workers: [
          {
            name: "ironcage-core",
            modules: true,
            script: refusesEverything,
            compatibilityDate: "2026-08-01",
          },
        ],
      },
    }),
  ],
});
