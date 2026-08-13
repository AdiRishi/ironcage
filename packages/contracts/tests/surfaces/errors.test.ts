import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { BoundaryError } from "../../src/schema";

describe("BoundaryError", () => {
  const decode = Schema.decodeUnknownSync(BoundaryError);

  test.each([
    { _tag: "ValidationFailed", reason: "InvalidPayload", detail: "missing request ID" },
    { _tag: "NotFound", entity: "Sleeve", id: "018f6b2a-7c4e-7d31-a2f0-3b9d4e8c1a55" },
    { _tag: "Conflict", reason: "RequestIdCollision", detail: "payload differs" },
    { _tag: "Stale", reason: "CoverageGap", detail: "June is incomplete" },
    { _tag: "Internal", detail: "read sleeve failed" },
  ])("decodes $_tag", (error) => {
    expect(decode(error)._tag).toBe(error._tag);
  });

  test("rejects errors outside the declared union", () => {
    expect(() => decode({ _tag: "SomethingElse", detail: "unknown" })).toThrow(/Expected/);
  });
});
