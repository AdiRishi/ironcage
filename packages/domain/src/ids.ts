import { Schema } from "effect";

/**
 * Every identifier that crosses a boundary is a UUIDv7. One format lets any ID
 * be logged, joined, and compared without knowing which table minted it, and
 * the embedded timestamp makes feed event IDs usable as cursors.
 */
const uuidV7 = <const Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand(name));

export const SleeveId = uuidV7("SleeveId");
export type SleeveId = typeof SleeveId.Type;

export const TransitionId = uuidV7("TransitionId");
export type TransitionId = typeof TransitionId.Type;

export const CeremonyId = uuidV7("CeremonyId");
export type CeremonyId = typeof CeremonyId.Type;

/** Doubles as the venue client-order ID, once a venue fixture accepts the form. */
export const IntentId = uuidV7("IntentId");
export type IntentId = typeof IntentId.Type;

export const FillId = uuidV7("FillId");
export type FillId = typeof FillId.Type;

export const FeedEventId = uuidV7("FeedEventId");
export type FeedEventId = typeof FeedEventId.Type;

export const DecisionRecordId = uuidV7("DecisionRecordId");
export type DecisionRecordId = typeof DecisionRecordId.Type;

export const EffectId = uuidV7("EffectId");
export type EffectId = typeof EffectId.Type;

export const ReservationId = uuidV7("ReservationId");
export type ReservationId = typeof ReservationId.Type;

/**
 * The deliberate exception. A run ID is a name-based UUID derived from the
 * capability, its configuration version, and the cadence slot it answers, so a
 * re-dispatched run collides with its earlier self instead of arriving as a
 * fresh identity.
 */
export const RunId = Schema.String.check(Schema.isUUID(5)).pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;
