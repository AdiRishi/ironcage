import { BigDecimal, Option } from "effect";

import type { Order } from "@app/contracts/trading";

const ZERO = BigDecimal.fromBigInt(0n);

const parse = (value: string): BigDecimal.BigDecimal =>
  Option.getOrThrowWith(
    BigDecimal.fromString(value),
    () => new Error(`Blotter: not a decimal string: "${value}"`),
  );

export interface TradeDerivedState {
  /** Base-currency amount still held. */
  readonly openAmount: BigDecimal.BigDecimal;
  /** Volume-weighted average entry price across all entry fills. */
  readonly averageEntryPrice: BigDecimal.BigDecimal | undefined;
  /** Realized PnL in quote currency (average-cost method), net of fees. */
  readonly realizedPnlQuote: BigDecimal.BigDecimal;
  readonly totalFeesQuote: BigDecimal.BigDecimal;
}

/**
 * Recompute a trade's derived state from its full, immutable order history —
 * never mutate incrementally (freqtrade's `recalc_trade_from_orders` pattern;
 * see AGENTS.md "Money Math"). Only `filled`/partially-filled data counts:
 * an order contributes exactly its `filledAmount` at `averageFillPrice`.
 */
export const recalcTradeFromOrders = (orders: ReadonlyArray<Order>): TradeDerivedState => {
  let boughtAmount = ZERO;
  let boughtCost = ZERO;
  let soldAmount = ZERO;
  let soldProceeds = ZERO;
  let totalFeesQuote = ZERO;

  for (const order of orders) {
    const filled = parse(order.filledAmount);
    if (BigDecimal.isLessThanOrEqualTo(filled, ZERO)) {
      continue;
    }
    if (order.averageFillPrice === undefined) {
      throw new Error(`Blotter: order ${order.clientOrderId} has fills but no average price.`);
    }
    const price = parse(order.averageFillPrice);
    const value = BigDecimal.multiply(filled, price);
    totalFeesQuote = BigDecimal.sum(totalFeesQuote, parse(order.feeQuote));
    if (order.side === "buy") {
      boughtAmount = BigDecimal.sum(boughtAmount, filled);
      boughtCost = BigDecimal.sum(boughtCost, value);
    } else {
      soldAmount = BigDecimal.sum(soldAmount, filled);
      soldProceeds = BigDecimal.sum(soldProceeds, value);
    }
  }

  const averageEntryPrice = BigDecimal.isZero(boughtAmount)
    ? undefined
    : BigDecimal.divideUnsafe(boughtCost, boughtAmount);

  // Average-cost basis for the sold portion.
  const costOfSold =
    averageEntryPrice === undefined ? ZERO : BigDecimal.multiply(soldAmount, averageEntryPrice);
  const realizedPnlQuote = BigDecimal.subtract(
    BigDecimal.subtract(soldProceeds, costOfSold),
    totalFeesQuote,
  );

  return {
    openAmount: BigDecimal.subtract(boughtAmount, soldAmount),
    averageEntryPrice,
    realizedPnlQuote,
    totalFeesQuote,
  };
};
