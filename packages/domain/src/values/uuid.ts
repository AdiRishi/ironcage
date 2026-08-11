import { Schema } from "effect";

/** Every persisted identifier is UUIDv7 unless its owning module documents otherwise. */
export const uuidV7 = <const Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand(name));
