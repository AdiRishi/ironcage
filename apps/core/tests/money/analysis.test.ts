import {
  BankAccountId,
  BankTransactionId,
  CategoryId,
  uuidV7From,
  type CalendarDate,
  type CategoryKind,
} from "@ironcage/domain";
import { BigDecimal, Schema } from "effect";
import { describe, expect, test } from "vitest";

import {
  computeAnomalies,
  computeMonths,
  computeRecurring,
  computeSuggestions,
  type SplitLine,
} from "../../src/money/analysis";

const accountId = Schema.decodeUnknownSync(BankAccountId)(uuidV7From(1, new Uint8Array(16)));
const transactionId = Schema.decodeUnknownSync(BankTransactionId);
const categoryId = Schema.decodeUnknownSync(CategoryId);

const categories = {
  salary: {
    id: categoryId("01900000-0000-7000-8000-000000000010"),
    kind: "income" as CategoryKind,
  },
  groceries: {
    id: categoryId("01900000-0000-7000-8000-000000000002"),
    kind: "expense" as CategoryKind,
  },
  subscriptions: {
    id: categoryId("01900000-0000-7000-8000-000000000009"),
    kind: "expense" as CategoryKind,
  },
};

let sequence = 0;
const line = (
  date: string,
  amount: string,
  category: keyof typeof categories,
  payee: string,
  id?: string,
): SplitLine => {
  sequence += 1;
  const random = new Uint8Array(16);
  random[15] = sequence % 256;
  random[14] = Math.floor(sequence / 256) % 256;
  return {
    transactionId: transactionId(id ?? uuidV7From(sequence, random)),
    accountId,
    postedDate: date as CalendarDate,
    payee,
    categoryId: categories[category].id,
    categoryName: category,
    kind: categories[category].kind,
    amount: BigDecimal.fromStringUnsafe(amount),
  };
};

const format = (value: BigDecimal.BigDecimal) => BigDecimal.format(BigDecimal.normalize(value));

describe("monthly analysis", () => {
  test("reproduces the chapter's worked example", () => {
    const lines = [
      line("2032-01-05", "5000", "salary", "EMPLOYER"),
      line("2032-01-10", "-1900", "groceries", "SHOP"),
      line("2032-01-12", "100", "groceries", "SHOP"), // refund reduces net spend
    ];

    const months = computeMonths(lines, new Set(["2032-01"]));
    expect(months).toHaveLength(1);
    const january = months[0]!;
    expect(format(january.income)).toBe("5000");
    expect(format(january.netSpend)).toBe("1800");
    expect(january.savingsRate).toBe("0.64");
    expect(january.complete).toBe(true);
  });

  test("net spend can be negative when refunds exceed purchases", () => {
    const months = computeMonths(
      [
        line("2032-01-10", "-50", "groceries", "SHOP"),
        line("2032-01-15", "80", "groceries", "SHOP"),
      ],
      new Set(["2032-01"]),
    );

    expect(format(months[0]!.netSpend)).toBe("-30");
  });

  test("a trailing average needs three complete earlier months, never fewer", () => {
    const lines = [
      line("2031-10-10", "-300", "groceries", "SHOP"),
      line("2031-11-10", "-600", "groceries", "SHOP"),
      line("2031-12-10", "-900", "groceries", "SHOP"),
      line("2032-01-10", "-100", "groceries", "SHOP"),
    ];

    const allComplete = computeMonths(lines, new Set(["2031-10", "2031-11", "2031-12", "2032-01"]));
    const january = allComplete.find((month) => month.month === "2032-01")!;
    expect(format(january.trailingThreeMonthNetSpend!)).toBe("600");

    const withGap = computeMonths(lines, new Set(["2031-10", "2031-12", "2032-01"]));
    expect(
      withGap.find((month) => month.month === "2032-01")!.trailingThreeMonthNetSpend,
    ).toBeNull();
  });

  test("a complete month with no transactions reports zero rather than vanishing", () => {
    const months = computeMonths([], new Set(["2032-01"]));
    expect(months).toHaveLength(1);
    expect(format(months[0]!.netSpend)).toBe("0");
  });
});

describe("recurring detection", () => {
  const monthly = (amounts: readonly string[]) =>
    amounts.map((amount, index) =>
      line(`2032-0${index + 1}-15`, `-${amount}`, "subscriptions", "STREAMFLIX"),
    );

  test("a steady monthly charge qualifies at the 30-day cadence", () => {
    const recurring = computeRecurring(
      monthly(["15.99", "15.99", "15.99", "15.99"]),
      "2032-04-30" as CalendarDate,
    );

    expect(recurring).toHaveLength(1);
    expect(recurring[0]!.cadenceDays).toBe(30);
    expect(recurring[0]!.occurrences).toBe(4);
    expect(format(recurring[0]!.medianAmount)).toBe("15.99");
    expect(recurring[0]!.priceChange).toBeNull();
  });

  test("two occurrences never qualify", () => {
    expect(
      computeRecurring(monthly(["15.99", "15.99"]).slice(0, 2), "2032-02-28" as CalendarDate),
    ).toHaveLength(0);
  });

  test("irregular gaps disqualify the group", () => {
    const lines = [
      line("2032-01-01", "-20.00", "subscriptions", "GYM"),
      line("2032-01-04", "-20.00", "subscriptions", "GYM"),
      line("2032-03-20", "-20.00", "subscriptions", "GYM"),
    ];
    expect(computeRecurring(lines, "2032-03-31" as CalendarDate)).toHaveLength(0);
  });

  test("a price change above one percent and one dollar is noticed", () => {
    const recurring = computeRecurring(
      monthly(["100.00", "100.00", "100.00", "101.50"]),
      "2032-04-30" as CalendarDate,
    );

    expect(recurring).toHaveLength(1);
    const change = recurring[0]!.priceChange!;
    expect(format(change.from)).toBe("100");
    expect(format(change.to)).toBe("101.5");
  });

  test("occurrences outside the 400-day window are ignored", () => {
    const lines = [
      line("2030-01-15", "-15.99", "subscriptions", "STREAMFLIX"),
      line("2030-02-15", "-15.99", "subscriptions", "STREAMFLIX"),
      line("2030-03-15", "-15.99", "subscriptions", "STREAMFLIX"),
    ];
    expect(computeRecurring(lines, "2032-04-30" as CalendarDate)).toHaveLength(0);
  });
});

describe("anomalies", () => {
  test("a large expense clears the floor-or-median threshold", () => {
    const lines = [
      line("2032-01-02", "-40", "groceries", "SHOP"),
      line("2032-01-05", "-45", "groceries", "SHOP"),
      line("2032-01-20", "-600", "groceries", "APPLIANCE STORE"),
    ];

    const months = computeMonths(lines, new Set(["2032-01"]));
    const anomalies = computeAnomalies(lines, months, new Set(["2032-01"]));
    const large = anomalies.filter((anomaly) => anomaly.rule === "large_expense");
    expect(large).toHaveLength(1);
    expect(large[0]!.subject).toBe("APPLIANCE STORE");
  });

  test("a new payee needs the amount floor", () => {
    const lines = [
      line("2032-01-05", "-250", "groceries", "NEW MERCHANT"),
      line("2032-01-06", "-150", "groceries", "SMALL MERCHANT"),
    ];

    const anomalies = computeAnomalies(lines, computeMonths(lines, new Set()), new Set());
    const fresh = anomalies.filter((anomaly) => anomaly.rule === "new_payee");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]!.subject).toBe("NEW MERCHANT");
  });

  test("a category spike compares against three complete months", () => {
    const lines = [
      line("2031-10-10", "-200", "groceries", "SHOP"),
      line("2031-11-10", "-200", "groceries", "SHOP"),
      line("2031-12-10", "-200", "groceries", "SHOP"),
      line("2032-01-10", "-400", "groceries", "SHOP"),
    ];
    const complete = new Set(["2031-10", "2031-11", "2031-12", "2032-01"]);

    const anomalies = computeAnomalies(lines, computeMonths(lines, complete), complete);
    const spikes = anomalies.filter((anomaly) => anomaly.rule === "category_spike");
    expect(spikes).toHaveLength(1);
    expect(spikes[0]!).toMatchObject({ subject: "groceries", month: "2032-01" });
  });
});

describe("suggestions", () => {
  const steady = computeRecurring(
    ["01", "02", "03", "04"].map((month) =>
      line(`2032-${month}-15`, "-15.99", "subscriptions", "STREAMFLIX"),
    ),
    "2032-04-30" as CalendarDate,
  );

  test("a steady charge above the annual floor is suggested", () => {
    const { suggestions, unavailable } = computeSuggestions(
      steady,
      new Set(["2032-01", "2032-02", "2032-03", "2032-04"]),
      "2032-04-30" as CalendarDate,
    );

    expect(unavailable).toBeNull();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.kind).toBe("steady_charge");
    // 15.99 × 365 / 30 = 194.545, rounded half-even to 194.54.
    expect(format(suggestions[0]!.annualAmount)).toBe("194.54");
  });

  test("a supporting-window gap makes suggestions unavailable", () => {
    const { suggestions, unavailable } = computeSuggestions(
      steady,
      new Set(["2032-01", "2032-03", "2032-04"]),
      "2032-04-30" as CalendarDate,
    );

    expect(suggestions).toHaveLength(0);
    expect(unavailable).toMatch(/2032-02/);
  });

  test("a price rise quotes the rise annualised, not the annual spend", () => {
    const risen = computeRecurring(
      ["01", "02", "03", "04"].map((month, index) =>
        line(`2032-${month}-15`, index === 3 ? "-101.50" : "-100.00", "subscriptions", "INSURER"),
      ),
      "2032-04-30" as CalendarDate,
    );

    const { suggestions } = computeSuggestions(
      risen,
      new Set(["2032-01", "2032-02", "2032-03", "2032-04"]),
      "2032-04-30" as CalendarDate,
    );

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]!.kind).toBe("price_rise");
    // (101.50 − 100.00) × 365 / 30 = 18.25.
    expect(format(suggestions[0]!.annualAmount)).toBe("18.25");
  });
});
