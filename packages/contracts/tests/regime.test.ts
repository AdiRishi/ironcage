import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RegimeSignal } from "@app/contracts/regime";

const decode = Schema.decodeUnknownSync(RegimeSignal);

describe("RegimeSignal", () => {
  it("decodes a valid signal", () => {
    const signal = decode({
      state: "HALF",
      confidence: 0.6,
      rationale: "elevated volatility",
      sources: ["funding", "news"],
      generatedAt: 1_700_000_000_000,
      staleAfterMs: 28_800_000,
    });
    expect(signal.state).toBe("HALF");
  });

  it("rejects an out-of-vocabulary state — the LLM cannot invent actions", () => {
    expect(() =>
      decode({
        state: "DOUBLE_DOWN",
        confidence: 1,
        rationale: "nope",
        sources: [],
        generatedAt: 0,
        staleAfterMs: 1,
      }),
    ).toThrow();
  });
});
