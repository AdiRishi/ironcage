import { afterAll, beforeAll, expect, test } from "vitest";
import { createTestHarness } from "wrangler";

const unreachable = "postgres://ironcage:unreachable@127.0.0.1:5432/ironcage";
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB = unreachable;
process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_DB_CACHED = unreachable;

const server = createTestHarness({
  workers: [
    { configPath: "./wrangler.jsonc" },
    { configPath: "../agents/wrangler.jsonc" },
    { configPath: "../compute/wrangler.jsonc" },
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
