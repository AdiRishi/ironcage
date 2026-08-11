import { Money } from "@ironcage/domain";
import { BigDecimal, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { aud, percent, signedAud } from "@/features/money/format";

const money = Schema.decodeUnknownSync(Money);

describe("money formatting", () => {
  it("rounds half-even at the minor unit", () => {
    expect(aud(money("1.005"))).toBe("$1.00");
    expect(aud(money("1.015"))).toBe("$1.02");
    expect(aud(money("-6285.755"))).toBe("-$6,285.76");
  });

  it("signs a credit so a ledger reads at a glance", () => {
    expect(signedAud(money("50.09"))).toBe("+$50.09");
    expect(signedAud(money("-6.2"))).toBe("-$6.20");
  });

  it("renders a savings rate as a percentage of one decimal", () => {
    expect(percent(BigDecimal.fromStringUnsafe("0.9638"))).toBe("96.4%");
  });
});
