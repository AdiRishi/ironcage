import { DateTime, Option, Schema } from "effect";
import { describe, expect, test } from "vitest";

import { Sleeve } from "../src/sleeve";

const id = "01912d68-783e-7c66-9d4b-6c4b2e9a1a2b";
const createdAt = new Date("2026-08-10T04:15:30.000Z");

const row = {
  id,
  name: "crypto-trend",
  market: "crypto",
  state: "dry_run",
  paused: false,
  shadow: false,
  activeMandate: 1,
  createdAt,
} as const;

// node-postgres hands back `timestamptz` as a Date, and JSON has no date at
// all. The variants exist so neither boundary has to know about the other.
describe("Sleeve variants", () => {
  test("the select variant decodes a row, taking a Date for a timestamp", () => {
    const sleeve = Schema.decodeSync(Sleeve.select)(row);

    expect(sleeve.name).toBe("crypto-trend");
    expect(DateTime.isDateTime(sleeve.createdAt)).toBe(true);
  });

  test("the json variant encodes the same sleeve to ISO-8601", () => {
    const sleeve = Schema.decodeSync(Sleeve.select)(row);
    const wire = Schema.encodeSync(Sleeve.json)(sleeve);

    expect(wire.createdAt).toBe("2026-08-10T04:15:30.000Z");
  });

  test("the select variant refuses a row whose timestamp arrived as a string", () => {
    const decoded = Schema.decodeUnknownOption(Sleeve.select)({
      ...row,
      createdAt: createdAt.toISOString(),
    });

    expect(Option.isNone(decoded)).toBe(true);
  });

  test("refuses a state outside the lifecycle", () => {
    const decoded = Schema.decodeUnknownOption(Sleeve.select)({ ...row, state: "paused" });

    expect(Option.isNone(decoded)).toBe(true);
  });
});
