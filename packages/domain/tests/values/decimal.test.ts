import { BigDecimal, Schema } from "effect";
import { describe, expect, expectTypeOf, test } from "vitest";

import type { Money as MoneyType, Price as PriceType, Quantity as QuantityType } from "../../src";
import { Money, Price, Quantity } from "../../src";

describe("financial decimals", () => {
  test("money fits numeric(20,8)", () => {
    const decode = Schema.decodeUnknownSync(Money);

    expect(BigDecimal.format(decode("999999999999.99999999"))).toBe("999999999999.99999999");
    expect(() => decode("1000000000000")).toThrow(/numeric\(20,8\)/);
    expect(() => decode("0.000000001")).toThrow(/numeric\(20,8\)/);
  });

  test("price fits numeric(24,8)", () => {
    const decode = Schema.decodeUnknownSync(Price);

    expect(BigDecimal.format(decode("9999999999999999.99999999"))).toBe(
      "9999999999999999.99999999",
    );
    expect(() => decode("10000000000000000")).toThrow(/numeric\(24,8\)/);
    expect(() => decode("0.000000001")).toThrow(/numeric\(24,8\)/);
  });

  test("quantity fits numeric(38,18)", () => {
    const decode = Schema.decodeUnknownSync(Quantity);
    const maximum = "99999999999999999999.999999999999999999";

    expect(BigDecimal.equals(decode(maximum), BigDecimal.fromStringUnsafe(maximum))).toBe(true);
    expect(() => decode("100000000000000000000")).toThrow(/numeric\(38,18\)/);
    expect(() => decode("0.0000000000000000001")).toThrow(/numeric\(38,18\)/);
  });

  test("money, price, and quantity are nominally distinct", () => {
    expectTypeOf<MoneyType>().not.toEqualTypeOf<PriceType>();
    expectTypeOf<MoneyType>().not.toEqualTypeOf<QuantityType>();
    expectTypeOf<PriceType>().not.toEqualTypeOf<QuantityType>();
  });
});
