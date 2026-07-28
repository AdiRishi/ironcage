import { BigDecimal } from "effect";
import { describe, expect, it } from "vitest";

import type { Order } from "@app/contracts/trading";
import { recalcTradeFromOrders } from "@app/core/blotter/trade";

const order = (overrides: Partial<Order>): Order => ({
  clientOrderId: "c1",
  tradeId: "t1",
  pair: "BTC/USD",
  side: "buy",
  type: "limit",
  status: "filled",
  intendedAmount: "1",
  intendedPrice: "100",
  filledAmount: "1",
  averageFillPrice: "100",
  feeQuote: "0",
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

const bd = (value: string) => BigDecimal.fromStringUnsafe(value);

describe("recalcTradeFromOrders", () => {
  it("computes a volume-weighted average entry across partial fills", () => {
    const state = recalcTradeFromOrders([
      order({ clientOrderId: "a", filledAmount: "1", averageFillPrice: "100" }),
      order({ clientOrderId: "b", filledAmount: "3", averageFillPrice: "120" }),
    ]);
    // (1*100 + 3*120) / 4 = 115
    expect(state.averageEntryPrice).toBeDefined();
    expect(BigDecimal.equals(state.averageEntryPrice!, bd("115"))).toBe(true);
    expect(BigDecimal.equals(state.openAmount, bd("4"))).toBe(true);
  });

  it("realizes PnL on the sold portion at average cost, net of fees", () => {
    const state = recalcTradeFromOrders([
      order({ clientOrderId: "a", filledAmount: "2", averageFillPrice: "100", feeQuote: "1" }),
      order({
        clientOrderId: "b",
        side: "sell",
        filledAmount: "1",
        averageFillPrice: "130",
        feeQuote: "1",
      }),
    ]);
    // proceeds 130 - cost 100 - fees 2 = 28
    expect(BigDecimal.equals(state.realizedPnlQuote, bd("28"))).toBe(true);
    expect(BigDecimal.equals(state.openAmount, bd("1"))).toBe(true);
  });

  it("ignores unfilled orders entirely", () => {
    const state = recalcTradeFromOrders([
      order({
        clientOrderId: "a",
        status: "canceled",
        filledAmount: "0",
        averageFillPrice: undefined,
      }),
    ]);
    expect(state.averageEntryPrice).toBeUndefined();
    expect(BigDecimal.isZero(state.openAmount)).toBe(true);
    expect(BigDecimal.isZero(state.realizedPnlQuote)).toBe(true);
  });

  it("is a pure recomputation: same orders, same result, any order", () => {
    const orders = [
      order({ clientOrderId: "a", filledAmount: "2", averageFillPrice: "100" }),
      order({ clientOrderId: "b", side: "sell", filledAmount: "1", averageFillPrice: "110" }),
      order({ clientOrderId: "c", filledAmount: "1", averageFillPrice: "90" }),
    ];
    const forward = recalcTradeFromOrders(orders);
    const reversed = recalcTradeFromOrders([...orders].reverse());
    expect(BigDecimal.equals(forward.openAmount, reversed.openAmount)).toBe(true);
    expect(BigDecimal.equals(forward.realizedPnlQuote, reversed.realizedPnlQuote)).toBe(true);
  });
});
