import { Schema } from "effect";

/** Every persisted identifier is UUIDv7 unless its owning module documents otherwise. */
export const uuidV7 = <const Name extends string>(name: Name) =>
  Schema.String.check(Schema.isUUID(7)).pipe(Schema.brand(name));

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export const uuidV7From = (timestampMillis: number, random: Uint8Array): string => {
  const bytes = random.slice(0, 16);

  bytes[0] = Math.floor(timestampMillis / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestampMillis / 2 ** 32) & 0xff;
  bytes[2] = Math.floor(timestampMillis / 2 ** 24) & 0xff;
  bytes[3] = Math.floor(timestampMillis / 2 ** 16) & 0xff;
  bytes[4] = Math.floor(timestampMillis / 2 ** 8) & 0xff;
  bytes[5] = timestampMillis & 0xff;
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return [
    hex(bytes.subarray(0, 4)),
    hex(bytes.subarray(4, 6)),
    hex(bytes.subarray(6, 8)),
    hex(bytes.subarray(8, 10)),
    hex(bytes.subarray(10, 16)),
  ].join("-");
};
