import { BigDecimal } from "effect";

import type { RegimeState } from "@app/contracts/regime";
import type { RiskConfig } from "@app/contracts/risk";

import { regimeMultiplier } from "../regime/state.ts";

/**
 * Deterministic stake sizing (freqtrade's "unlimited stake" formula, made
 * regime-aware): the tradable slice of equity, divided across the maximum
 * number of concurrent positions, scaled by the regime multiplier.
 *
 * The regime input can only shrink the result — `OFF` yields zero.
 */
export const positionSizeQuote = (
  config: RiskConfig,
  equityQuote: BigDecimal.BigDecimal,
  regime: RegimeState,
): BigDecimal.BigDecimal => {
  const tradable = BigDecimal.multiply(
    equityQuote,
    BigDecimal.fromNumberUnsafe(config.tradableBalanceRatio),
  );
  const perSlot = BigDecimal.multiply(
    tradable,
    BigDecimal.fromNumberUnsafe(1 / config.maxConcurrentPositions),
  );
  return BigDecimal.multiply(perSlot, BigDecimal.fromNumberUnsafe(regimeMultiplier(regime)));
};
