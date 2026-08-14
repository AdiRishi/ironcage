import { resolve } from "node:path";

import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestHarness } from "wrangler";

const unreachable = "postgres://ironcage:unreachable@127.0.0.1:5432/ironcage";
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB = unreachable;
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB_CACHED = unreachable;

const server = createTestHarness({
  root: resolve(import.meta.dirname, "../../.."),
  workers: [
    {
      config: {
        name: "ironcage-core",
        main: "apps/core/src/index.ts",
        compatibility_date: "2026-08-01",
        compatibility_flags: ["nodejs_compat"],
        services: [
          {
            binding: "AGENTS",
            service: "ironcage-agents",
            entrypoint: "DispatchApiEntrypoint",
          },
        ],
        durable_objects: {
          bindings: [
            {
              name: "COMPUTE",
              class_name: "BacktestRunner",
              script_name: "ironcage-compute",
            },
          ],
        },
        hyperdrive: [
          { binding: "DB", id: "00000000000000000000000000000000" },
          { binding: "DB_CACHED", id: "11111111111111111111111111111111" },
        ],
        r2_buckets: [{ binding: "BLOBS", bucket_name: "ironcage-test" }],
      },
    },
    {
      config: {
        name: "ironcage-agents",
        main: "apps/agents/src/index.ts",
        compatibility_date: "2026-08-01",
        compatibility_flags: ["nodejs_compat"],
        services: [
          {
            binding: "CORE",
            service: "ironcage-core",
            entrypoint: "AgentReadApiEntrypoint",
          },
        ],
      },
    },
    {
      config: {
        name: "ironcage-compute",
        main: "apps/compute/src/index.ts",
        compatibility_date: "2026-08-01",
        compatibility_flags: ["nodejs_compat"],
        durable_objects: {
          bindings: [
            { name: "BACKTEST", class_name: "BacktestRunner" },
            { name: "STATEMENT_EXTRACTION", class_name: "StatementExtractor" },
          ],
        },
        r2_buckets: [{ binding: "BLOBS", bucket_name: "ironcage-test" }],
        migrations: [
          {
            tag: "v1",
            new_sqlite_classes: ["BacktestRunner", "StatementExtractor"],
          },
        ],
      },
    },
  ],
});

beforeAll(() => server.listen());
afterAll(() => server.close());

test("core reaches its configured sibling Workers", async () => {
  const response = await server.getWorker("ironcage-core").fetch("http://core.ironcage.test/");

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    _tag: "Success",
    value: {
      worker: "ironcage-core",
      AGENTS: { worker: "ironcage-agents", surface: "DispatchApi" },
      COMPUTE: { worker: "ironcage-compute", object: "BacktestRunner" },
      DB: { configured: true },
      DB_CACHED: { configured: true },
      BLOBS: { reachable: true },
    },
  });
});
