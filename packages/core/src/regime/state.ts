import type { RegimeSignal, RegimeState } from "@app/contracts/regime";

/**
 * The regime signal's entire influence on trading: a multiplier on the
 * position size the strategy would otherwise take. It can never exceed 1.
 */
export const regimeMultiplier = (state: RegimeState): number => {
  switch (state) {
    case "ON":
      return 1;
    case "HALF":
      return 0.5;
    case "OFF":
      return 0;
  }
};

export const isStale = (signal: RegimeSignal, nowMs: number): boolean =>
  nowMs >= signal.generatedAt + signal.staleAfterMs;

/**
 * Fail closed: no signal, or a stale one, is OFF. This is the only correct
 * resolution of ambiguity anywhere in the system (docs/VISION.md, principle 1).
 */
export const effectiveState = (signal: RegimeSignal | undefined, nowMs: number): RegimeState =>
  signal === undefined || isStale(signal, nowMs) ? "OFF" : signal.state;
