import { mintUuidV7 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

/** Mints a UUIDv7 and decodes it into the requested branded identifier. */
export const mintId = <Id>(schema: Schema.Decoder<Id, never>): Effect.Effect<Id> =>
  Effect.sync(() => Schema.decodeUnknownSync(schema)(mintUuidV7()));

export { mintUuidV7 };
