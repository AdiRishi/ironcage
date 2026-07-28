import { Schema } from "effect";

import { RegimeState } from "./regime.ts";

export const OrderSide = Schema.Literals(["buy", "sell"]);
export type OrderSide = typeof OrderSide.Type;

export const OrderType = Schema.Literals(["limit", "market"]);
export type OrderType = typeof OrderType.Type;

export const OrderStatus = Schema.Literals(["pending", "open", "filled", "canceled", "rejected"]);
export type OrderStatus = typeof OrderStatus.Type;

/**
 * Monetary amounts travel as decimal strings at every boundary and are parsed
 * into `BigDecimal` for arithmetic (`@app/core/blotter/trade`). Never floats.
 */
export const DecimalString = Schema.String;

/**
 * An order as the blotter records it. Freqtrade-inspired split: `intended*`
 * fields are what we asked for; `filled*` fields are what the exchange
 * reports. Derived trade state is always recomputed from these rows.
 */
export const Order = Schema.Struct({
  /** Idempotency key — generated at intent time, sent to the exchange. */
  clientOrderId: Schema.String,
  tradeId: Schema.String,
  pair: Schema.String,
  side: OrderSide,
  type: OrderType,
  status: OrderStatus,
  intendedAmount: DecimalString,
  intendedPrice: Schema.UndefinedOr(DecimalString),
  filledAmount: DecimalString,
  averageFillPrice: Schema.UndefinedOr(DecimalString),
  feeQuote: DecimalString,
  /** Epoch milliseconds. */
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});
export type Order = typeof Order.Type;

/**
 * A typed request to change a position, emitted by the engine only after
 * strategy + regime + cage evaluation. The cage verdict it passed travels
 * with it and is persisted (including rejections).
 */
export const OrderIntent = Schema.Struct({
  clientOrderId: Schema.String,
  pair: Schema.String,
  side: OrderSide,
  type: OrderType,
  amountQuote: DecimalString,
  limitPrice: Schema.UndefinedOr(DecimalString),
  /** The strategy signal this intent was born under. */
  strategyTag: Schema.String,
  regimeState: RegimeState,
  createdAt: Schema.Number,
});
export type OrderIntent = typeof OrderIntent.Type;

/**
 * A deterministic no-entry marker — the mechanism behind cooldowns,
 * stoploss-guard, and drawdown halts. `pair: "*"` locks everything.
 */
export const PairLock = Schema.Struct({
  pair: Schema.String,
  reason: Schema.String,
  /** Epoch milliseconds. */
  lockedAt: Schema.Number,
  expiresAt: Schema.Number,
});
export type PairLock = typeof PairLock.Type;
