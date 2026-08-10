import { env } from "cloudflare:test";
import { expect, test } from "vitest";

import "../src/index";

test("the backtest object answers a stub call", async () => {
  const stub = env.BACKTEST.getByName("test");

  await expect(stub.ping()).resolves.toStrictEqual({
    worker: "ironcage-compute",
    object: "BacktestRunner",
  });
});
