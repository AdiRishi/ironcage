import { BigDecimal } from "effect";

import type { RiskConfig } from "@app/contracts/risk";

/**
 * A snapshot of everything the cage needs to judge an intent. Any field the
 * caller cannot produce must be passed as `undefined` — the cage then rejects
 * with `state-unavailable` rather than trading blind (fail closed).
 */
export interface PortfolioState {
  readonly equityQuote: BigDecimal.BigDecimal | undefined;
  readonly openPositionCount: number | undefined;
  /** Current position value in quote currency for the intent's pair. */
  readonly positionValueQuoteForPair: BigDecimal.BigDecimal | undefined;
  /** Realized loss today as a percentage of equity (>= 0). */
  readonly dailyRealizedLossPct: number | undefined;
  /** Drawdown from the equity high-water mark as a percentage (>= 0). */
  readonly drawdownPct: number | undefined;
  readonly tradesToday: number | undefined;
  /** Pairs currently locked by protections; "*" means everything. */
  readonly lockedPairs: ReadonlySet<string>;
}

export interface EntryRequest {
  readonly pair: string;
  /** Requested position size in quote currency. */
  readonly amountQuote: BigDecimal.BigDecimal;
}

export type Verdict =
  | { readonly _tag: "Approved"; readonly amountQuote: BigDecimal.BigDecimal }
  | { readonly _tag: "Rejected"; readonly reasons: ReadonlyArray<string> };

const pct = (value: BigDecimal.BigDecimal, percent: number): BigDecimal.BigDecimal =>
  BigDecimal.multiply(value, BigDecimal.fromNumberUnsafe(percent / 100));

/**
 * The iron cage, as a pure function. Evaluates an entry request against the
 * config and the portfolio snapshot; collects every violated rule, not just
 * the first. Exits are never gated here — the cage only restricts risk-adding
 * actions.
 */
export const evaluateEntry = (
  config: RiskConfig,
  state: PortfolioState,
  request: EntryRequest,
): Verdict => {
  const reasons: Array<string> = [];

  // Fail closed: uncomputable state is an automatic rejection.
  if (
    state.equityQuote === undefined ||
    state.openPositionCount === undefined ||
    state.positionValueQuoteForPair === undefined ||
    state.dailyRealizedLossPct === undefined ||
    state.drawdownPct === undefined ||
    state.tradesToday === undefined
  ) {
    return { _tag: "Rejected", reasons: ["state-unavailable"] };
  }

  if (!config.allowedPairs.includes(request.pair)) {
    reasons.push(`pair-not-allowed:${request.pair}`);
  }
  if (state.lockedPairs.has("*") || state.lockedPairs.has(request.pair)) {
    reasons.push(`pair-locked:${request.pair}`);
  }
  if (state.openPositionCount >= config.maxConcurrentPositions) {
    reasons.push("max-concurrent-positions");
  }
  if (state.dailyRealizedLossPct >= config.dailyLossHaltPct) {
    reasons.push("daily-loss-halt");
  }
  if (state.drawdownPct >= config.maxDrawdownKillPct) {
    reasons.push("kill-switch");
  }
  if (state.tradesToday >= config.maxTradesPerDay) {
    reasons.push("trade-frequency-cap");
  }

  const perPairCap = pct(state.equityQuote, config.maxPositionPctPerPair);
  const headroom = BigDecimal.subtract(perPairCap, state.positionValueQuoteForPair);
  if (BigDecimal.isLessThanOrEqualTo(headroom, BigDecimal.fromBigInt(0n))) {
    reasons.push("per-pair-cap-exhausted");
  }

  if (reasons.length > 0) {
    return { _tag: "Rejected", reasons };
  }

  // Approve, clamped to the remaining per-pair headroom. The cage may shrink
  // an intent; it never grows one.
  const amountQuote = BigDecimal.min(request.amountQuote, headroom);
  return { _tag: "Approved", amountQuote };
};
