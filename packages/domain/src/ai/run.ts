import { Schema } from "effect";
import { v5 as uuidV5 } from "uuid";

/**
 * A name-based UUID derived from the capability, its configuration version,
 * and the trigger anchor it answers — a cadence slot or a batch identity — so
 * a re-dispatched run collides with its earlier self instead of arriving as a
 * fresh identity.
 */
export const RunId = Schema.String.check(Schema.isUUID(5)).pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;

/** The fixed namespace every Ironcage run identity hashes under. */
const runIdNamespace = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/**
 * UUIDv5 over `capability|configVersion|anchor`. The producer and any
 * re-dispatch derive the same identity, which is what lets the consumer's
 * dedupe boundary treat a duplicate delivery as exactly that.
 */
export const deriveRunId = (capability: string, configVersion: number, anchor: string): RunId =>
  Schema.decodeUnknownSync(RunId)(
    uuidV5(`${capability}|${configVersion}|${anchor}`, runIdNamespace),
  );
