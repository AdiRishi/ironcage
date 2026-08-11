import { Schema } from "effect";
import { Model } from "effect/unstable/schema";

import { CeremonyId } from "../governance/ceremony";
import { Timestamp } from "../values/time";
import { uuidV7 } from "../values/uuid";

export const SleeveId = uuidV7("SleeveId");
export type SleeveId = typeof SleeveId.Type;

export const TransitionId = uuidV7("TransitionId");
export type TransitionId = typeof TransitionId.Type;

export const Market = Schema.Literals(["crypto", "stocks"]);
export type Market = typeof Market.Type;

export const SleeveState = Schema.Literals(["draft", "dry_run", "live", "halted", "retired"]);
export type SleeveState = typeof SleeveState.Type;

/**
 * A bounded allocation of capital with its own mandate. `state` and `paused`
 * are the only mutable columns, and every change to either appends a
 * `SleeveTransition` in the same transaction.
 */
export class Sleeve extends Model.Class<Sleeve>("Sleeve")({
  id: Model.GeneratedByApp(SleeveId),
  name: Schema.String,
  market: Market,
  state: SleeveState,
  paused: Schema.Boolean,
  /** Gate-pipeline challengers, excluded from the roster and from capital. */
  shadow: Schema.Boolean,
  activeMandate: Schema.Int,
  createdAt: Timestamp,
}) {}

export class SleeveTransition extends Model.Class<SleeveTransition>("SleeveTransition")({
  id: Model.GeneratedByApp(TransitionId),
  sleeveId: SleeveId,
  fromState: SleeveState,
  toState: SleeveState,
  /** `operator` | `cage:<rule>` | `reconciliation` | `system_cage`. */
  triggeredBy: Schema.String,
  reason: Schema.String,
  /** Required for operator transitions except halts, which are never gated. */
  ceremonyId: Model.FieldOption(CeremonyId),
  occurredAt: Timestamp,
}) {}
