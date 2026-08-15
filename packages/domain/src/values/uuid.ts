import { Schema } from "effect";
import { v7 } from "uuid";

/** Every persisted identifier is UUIDv7 unless its owning module documents otherwise. */
export const uuidV7 = <const Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand(name));

export const mintUuidV7 = (): string => v7();

export const uuidV7From = (timestampMillis: number, random: Uint8Array): string =>
  v7({ msecs: timestampMillis, random });
