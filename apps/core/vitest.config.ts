import { readFile } from "node:fs/promises";
import { URL, fileURLToPath, pathToFileURL } from "node:url";

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { configDefaults, defineConfig } from "vitest/config";

// `?raw` decodes a fixture as UTF-8 before a parser sees it. Bank fixtures are
// byte contracts whose declared character set may be Windows-1252.
const suffix = "?bytes";
const fixtureBytes = {
  name: "ironcage:fixture-bytes",
  enforce: "pre" as const,
  resolveId(id: string, importer: string | undefined) {
    return id.endsWith(suffix) && importer !== undefined
      ? `${fileURLToPath(new URL(id.slice(0, -suffix.length), pathToFileURL(importer)))}${suffix}`
      : null;
  },
  async load(id: string) {
    if (!id.endsWith(suffix)) return null;

    const base64 = await readFile(id.slice(0, -suffix.length), "base64");

    return `export default Uint8Array.from(atob(${JSON.stringify(base64)}), (character) => character.charCodeAt(0));`;
  },
};

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

// Unreachable on purpose, and never connected to: workerd refuses to start a
// Hyperdrive binding without one. A test that needs the database belongs in
// the integration suite backed by Testcontainers.
const unreachable = "postgres://ironcage:unreachable@127.0.0.1:5432/ironcage";

export default defineConfig({
  plugins: [
    fixtureBytes,
    cloudflareTest({
      main: "./src/index.ts",
      miniflare: {
        name: "ironcage-core",
        compatibilityDate: "2026-08-01",
        compatibilityFlags: ["nodejs_compat"],
        serviceBindings: {
          AGENTS: { name: "ironcage-agents", entrypoint: "DispatchApiEntrypoint" },
        },
        durableObjects: {
          COMPUTE: { className: "BacktestRunner", scriptName: "ironcage-compute" },
        },
        hyperdrives: { DB: unreachable, DB_CACHED: unreachable },
        r2Buckets: ["BLOBS"],
        workers: [
          stub("ironcage-agents"),
          { ...stub("ironcage-compute"), durableObjects: { BACKTEST: "BacktestRunner" } },
        ],
      },
    }),
  ],
  test: {
    exclude: [...configDefaults.exclude, "tests/**/*.integration.test.ts"],
  },
});
