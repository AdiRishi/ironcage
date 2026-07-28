import { describe, expect, it } from "vitest";

import type { RegimeSignal } from "@app/contracts/regime";
import { effectiveState, regimeMultiplier } from "@app/core/regime/state";

const signal = (overrides: Partial<RegimeSignal>): RegimeSignal => ({
  state: "ON",
  confidence: 0.8,
  rationale: "test",
  sources: ["test"],
  generatedAt: 1_000,
  staleAfterMs: 8 * 60 * 60 * 1000,
  ...overrides,
});

describe("regimeMultiplier", () => {
  it("can only reduce: never exceeds 1", () => {
    expect(regimeMultiplier("ON")).toBe(1);
    expect(regimeMultiplier("HALF")).toBe(0.5);
    expect(regimeMultiplier("OFF")).toBe(0);
  });
});

describe("effectiveState", () => {
  it("fails closed on a missing signal", () => {
    expect(effectiveState(undefined, 1_000)).toBe("OFF");
  });

  it("fails closed on a stale signal", () => {
    const s = signal({ generatedAt: 0, staleAfterMs: 500 });
    expect(effectiveState(s, 1_000)).toBe("OFF");
  });

  it("passes a fresh signal through", () => {
    expect(effectiveState(signal({}), 2_000)).toBe("ON");
  });
});
