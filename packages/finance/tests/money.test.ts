import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { formatMoney, parseMoney } from "../src/money.ts";

it.effect("keeps decimal amounts exact beyond JavaScript's safe integer range", () =>
  Effect.gen(function* () {
    expect(yield* parseMoney("90071992547409.93", "AUD")).toEqual({
      currency: "AUD",
      minor: 9007199254740993n,
    });
    expect(yield* parseMoney("-12.50", "AUD")).toEqual({ currency: "AUD", minor: -1250n });
    expect(yield* parseMoney("+1.2", "AUD")).toEqual({ currency: "AUD", minor: 120n });
    expect(formatMoney({ currency: "AUD", minor: -9007199254740993n })).toBe(
      "−90,071,992,547,409.93 AUD",
    );
  }),
);
it.effect("rejects precision that the booked currency cannot represent", () =>
  Effect.gen(function* () {
    expect((yield* Effect.flip(parseMoney("1.001", "AUD"))).kind).toBe("invalid");
    expect(yield* parseMoney("123", "JPY")).toEqual({ currency: "JPY", minor: 123n });
  }),
);
