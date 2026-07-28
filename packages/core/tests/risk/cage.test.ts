import { BigDecimal } from "effect";
import { describe, expect, it } from "vitest";

import { defaultRiskConfig } from "@app/contracts/risk";
import { evaluateEntry, type EntryRequest, type PortfolioState } from "@app/core/risk/cage";

const bd = (value: number) => BigDecimal.fromNumberUnsafe(value);

const healthyState: PortfolioState = {
  equityQuote: bd(1000),
  openPositionCount: 0,
  positionValueQuoteForPair: bd(0),
  dailyRealizedLossPct: 0,
  drawdownPct: 0,
  tradesToday: 0,
  lockedPairs: new Set(),
};

const request: EntryRequest = { pair: "BTC/USD", amountQuote: bd(40) };

describe("evaluateEntry", () => {
  it("approves a healthy request, clamped to the per-pair cap", () => {
    const verdict = evaluateEntry(defaultRiskConfig, healthyState, request);
    expect(verdict._tag).toBe("Approved");
    if (verdict._tag === "Approved") {
      expect(BigDecimal.equals(verdict.amountQuote, bd(40))).toBe(true);
    }
  });

  it("clamps an oversized request to remaining per-pair headroom, never grows it", () => {
    // 5% of 1000 = 50 cap; 100 requested → 50 approved.
    const verdict = evaluateEntry(defaultRiskConfig, healthyState, {
      pair: "BTC/USD",
      amountQuote: bd(100),
    });
    expect(verdict._tag).toBe("Approved");
    if (verdict._tag === "Approved") {
      expect(BigDecimal.equals(verdict.amountQuote, bd(50))).toBe(true);
    }
  });

  it("fails closed when any portfolio input is unavailable", () => {
    const verdict = evaluateEntry(
      defaultRiskConfig,
      { ...healthyState, equityQuote: undefined },
      request,
    );
    expect(verdict).toEqual({ _tag: "Rejected", reasons: ["state-unavailable"] });
  });

  it("collects every violated rule, not just the first", () => {
    const verdict = evaluateEntry(
      defaultRiskConfig,
      {
        ...healthyState,
        openPositionCount: 3,
        drawdownPct: 20,
        tradesToday: 6,
        lockedPairs: new Set(["*"]),
      },
      { pair: "DOGE/USD", amountQuote: bd(40) },
    );
    expect(verdict._tag).toBe("Rejected");
    if (verdict._tag === "Rejected") {
      expect(verdict.reasons).toEqual(
        expect.arrayContaining([
          "pair-not-allowed:DOGE/USD",
          "pair-locked:DOGE/USD",
          "max-concurrent-positions",
          "kill-switch",
          "trade-frequency-cap",
        ]),
      );
    }
  });

  it("rejects when the daily loss halt has tripped", () => {
    const verdict = evaluateEntry(
      defaultRiskConfig,
      { ...healthyState, dailyRealizedLossPct: 3 },
      request,
    );
    expect(verdict._tag).toBe("Rejected");
  });

  it("rejects when the per-pair cap is already exhausted", () => {
    const verdict = evaluateEntry(
      defaultRiskConfig,
      { ...healthyState, positionValueQuoteForPair: bd(50) },
      request,
    );
    expect(verdict).toEqual({ _tag: "Rejected", reasons: ["per-pair-cap-exhausted"] });
  });
});
