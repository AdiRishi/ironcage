import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { formatCurrency, formatDecimal, formatMoney, parseMoney } from "../src/money.ts";

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

it("formats editable amounts using the currency's exponent", () => {
  expect(formatDecimal({ currency: "JPY", minor: 125n })).toBe("125");
  expect(formatDecimal({ currency: "KWD", minor: -125n })).toBe("-0.125");
  expect(formatDecimal({ currency: "AUD", minor: 9007199254740993n })).toBe("90071992547409.93");
});

it("formats currency for reading, with cents or rounded to whole units", () => {
  expect(formatCurrency({ currency: "AUD", minor: 638045n })).toBe("$6,380.45");
  expect(formatCurrency({ currency: "AUD", minor: 638050n }, { cents: false })).toBe("$6,381");
  expect(formatCurrency({ currency: "AUD", minor: -1999n })).toBe("−$19.99");
  expect(formatCurrency({ currency: "AUD", minor: 9007199254740993n }, { cents: false })).toBe(
    "$90,071,992,547,410",
  );
});

it("keeps the cents of an amount under a dollar when rounding to whole dollars", () => {
  expect(formatCurrency({ currency: "AUD", minor: 40n }, { cents: false })).toBe("$0.40");
  expect(formatCurrency({ currency: "AUD", minor: -99n }, { cents: false })).toBe("−$0.99");
  expect(formatCurrency({ currency: "AUD", minor: 100n }, { cents: false })).toBe("$1");
  expect(formatCurrency({ currency: "AUD", minor: 150n }, { cents: false })).toBe("$2");
  expect(formatCurrency({ currency: "AUD", minor: 0n }, { cents: false })).toBe("$0");
});
