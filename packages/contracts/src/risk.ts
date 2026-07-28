import { Schema } from "effect";

/**
 * The iron cage. Lives in code, versioned; changing it is a reviewed commit,
 * not a runtime toggle. The engine loads exactly one of these.
 */
export const RiskConfig = Schema.Struct({
  /** Max position size as a percentage of account equity, per pair. */
  maxPositionPctPerPair: Schema.Number,
  maxConcurrentPositions: Schema.Int,
  /** Fraction of the account the system may touch at all (0..1). */
  tradableBalanceRatio: Schema.Number,
  /** Hard stop-loss applied to every position, as a percentage. */
  hardStopLossPct: Schema.Number,
  /** Daily realized loss (pct of equity) that halts the engine for 24h. */
  dailyLossHaltPct: Schema.Number,
  /** Drawdown (pct from equity high-water mark) that triggers the kill switch. */
  maxDrawdownKillPct: Schema.Number,
  /** Fee-death guard. */
  maxTradesPerDay: Schema.Int,
  /** A regime signal older than this many regime intervals is OFF. */
  regimeStaleAfterIntervals: Schema.Int,
  allowedPairs: Schema.Array(Schema.String),
  /** Structural flags — schema-level documentation that these never flip. */
  spotOnly: Schema.Literal(true),
  noLeverage: Schema.Literal(true),
});
export type RiskConfig = typeof RiskConfig.Type;

/** The M0 defaults from docs/TECHNICAL.md — conservative on purpose. */
export const defaultRiskConfig: RiskConfig = {
  maxPositionPctPerPair: 5,
  maxConcurrentPositions: 3,
  tradableBalanceRatio: 0.95,
  hardStopLossPct: 5,
  dailyLossHaltPct: 3,
  maxDrawdownKillPct: 15,
  maxTradesPerDay: 6,
  regimeStaleAfterIntervals: 2,
  allowedPairs: ["BTC/USD", "ETH/USD"],
  spotOnly: true,
  noLeverage: true,
};
