import { uuidV7From } from "@ironcage/domain";
import { Effect, Schema } from "effect";

export const mintRawUuidV7 = (): string => {
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  return uuidV7From(Date.now(), random);
};

/** Mints a UUIDv7 and decodes it into the requested branded identifier. */
export const mintId = <Id>(schema: Schema.Decoder<Id, never>): Effect.Effect<Id> =>
  Effect.sync(() => Schema.decodeUnknownSync(schema)(mintRawUuidV7()));
