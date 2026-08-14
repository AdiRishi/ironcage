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

// Junk bytes prove the WebAssembly extractor initializes and answers inside
// workerd; real-statement extraction quality is proven against the private
// corpus, which never enters the repository.
test("the statement extractor runs anydoc and refuses non-documents", async () => {
  const stub = env.STATEMENT_EXTRACTION.getByName("test");

  await expect(stub.extract(new TextEncoder().encode("not a pdf"))).rejects.toMatchObject({
    code: "malformed",
  });
});
