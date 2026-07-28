import { Schema } from "effect";

/**
 * The LLM's only output that touches trading. `ON`/`HALF`/`OFF` maps to a
 * position-size multiplier of 1.0 / 0.5 / 0 — it can only reduce what the
 * strategy would otherwise do. See docs/adr/0001.
 */
export const RegimeState = Schema.Literals(["ON", "HALF", "OFF"]);
export type RegimeState = typeof RegimeState.Type;

export const RegimeSignal = Schema.Struct({
  state: RegimeState,
  /** 0..1 — the LLM's own confidence; informational, never a multiplier. */
  confidence: Schema.Number,
  /** One-paragraph explanation, persisted for the audit trail. */
  rationale: Schema.String,
  /** Identifiers of the independent sources that fed this tick. */
  sources: Schema.Array(Schema.String),
  /** Epoch milliseconds. */
  generatedAt: Schema.Number,
  /** The signal is treated as OFF once `generatedAt + staleAfterMs` passes. */
  staleAfterMs: Schema.Number,
});
export type RegimeSignal = typeof RegimeSignal.Type;
