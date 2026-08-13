import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { RequestId, Sha256, uuidV7From } from "../../src";

describe("shared identity values", () => {
  test("mints a UUIDv7 with the supplied clock and entropy", () => {
    const entropy = Uint8Array.from({ length: 16 }, (_, index) => index);
    const value = uuidV7From(0, entropy);

    expect(value).toBe("00000000-0000-7607-8809-0a0b0c0d0e0f");
    expect(Schema.decodeUnknownSync(RequestId)(value)).toBe(value);
    expect(entropy).toEqual(Uint8Array.from({ length: 16 }, (_, index) => index));
  });

  test("accepts only lowercase SHA-256 digests", () => {
    const decode = Schema.decodeUnknownSync(Sha256);

    expect(decode("a".repeat(64))).toBe("a".repeat(64));
    expect(() => decode("A".repeat(64))).toThrow(/Expected/);
    expect(() => decode("a".repeat(63))).toThrow(/Expected/);
  });
});
