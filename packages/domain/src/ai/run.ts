import { Schema } from "effect";

/**
 * A name-based UUID derived from the capability, its configuration version,
 * and the cadence slot it answers, so a re-dispatched run collides with its
 * earlier self instead of arriving as a fresh identity.
 */
export const RunId = Schema.String.check(Schema.isUUID(5)).pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;
