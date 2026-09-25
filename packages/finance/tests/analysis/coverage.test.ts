import { expect, it } from "@effect/vitest";
import { type Account, AccountId, CalendarDate, YearMonth } from "@repo/contracts/finance";

import {
  accountCoverage,
  comparisonCoverage,
  monthCoverage,
  monthsPeriod,
  periodGaps,
} from "../../src/index.ts";

const day = (value: string) => CalendarDate.make(value);
const account = (n: number, kind: Account["kind"], label: string): Account => ({
  id: AccountId.make(`20000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
  kind,
  institution: "commbank",
  label,
  currency: "AUD",
  bankId: null,
  accountNumber: null,
  version: 1,
});
const everyday = account(1, "deposit", "Everyday");
const card = account(2, "card", "Everyday card");
const savings = account(3, "deposit", "Savings");
const accounts = [everyday, card, savings];
const records = (item: Account, first: string, last: string) => ({
  accountId: item.id,
  observedStart: day(first),
  observedEnd: day(last),
  openingOn: null,
  closingOn: null,
  reconciled: false,
});
// A statement whose balances reconcile from its first stated day to its last.
const statement = (item: Account, first: string, last: string, from: string, to: string) => ({
  ...records(item, first, last),
  openingOn: day(from),
  closingOn: day(to),
  reconciled: true,
});
const march2026 = { start: day("2026-03-01"), endExclusive: day("2026-04-01") };
const march2025 = { start: day("2025-03-01"), endExclusive: day("2025-04-01") };
const coverageOf = (sources: Parameters<typeof accountCoverage>[0]["sources"]) =>
  comparisonCoverage(
    accountCoverage({ accounts, sources, imports: [] }, march2026),
    march2026,
    march2025,
  );

it("a comparison is complete when every account recorded in the period has records in it", () => {
  expect(
    coverageOf([
      records(everyday, "2024-07-01", "2026-03-31"),
      records(card, "2024-07-01", "2026-03-31"),
      records(savings, "2019-01-01", "2024-12-31"),
    ]),
  ).toEqual({ state: "complete", gaps: [] });
});

it("a card whose records start mid-month leaves the days before them out of the comparison", () => {
  expect(
    coverageOf([
      records(everyday, "2024-07-01", "2026-03-31"),
      records(card, "2025-03-15", "2026-03-31"),
    ]),
  ).toEqual({
    state: "partial",
    gaps: [
      {
        account: { id: card.id, kind: "card", label: "Everyday card", currency: "AUD" },
        missing: [{ start: "2025-03-01", endExclusive: "2025-03-15" }],
      },
    ],
  });
});

it("a comparison before every recorded account's records is missing, not zero", () => {
  expect(
    coverageOf([
      records(everyday, "2025-06-01", "2026-03-31"),
      records(card, "2025-09-01", "2026-03-31"),
    ]),
  ).toMatchObject({
    state: "missing",
    gaps: [
      { account: { id: everyday.id }, missing: [march2025] },
      { account: { id: card.id }, missing: [march2025] },
    ],
  });
});

it("days a reconciled statement spans count as recorded, even with no transactions on them", () => {
  expect(
    coverageOf([
      statement(everyday, "2025-03-03", "2025-03-14", "2025-03-01", "2025-03-16"),
      statement(everyday, "2025-03-17", "2025-03-31", "2025-03-17", "2025-03-31"),
      records(everyday, "2025-04-01", "2026-03-31"),
    ]),
  ).toEqual({ state: "complete", gaps: [] });
});

it("a comparison another account has records for is partial, not missing", () => {
  expect(
    coverageOf([
      records(everyday, "2024-07-01", "2026-02-28"),
      records(card, "2026-03-01", "2026-03-31"),
    ]),
  ).toEqual({
    state: "partial",
    gaps: [
      {
        account: { id: card.id, kind: "card", label: "Everyday card", currency: "AUD" },
        missing: [march2025],
      },
    ],
  });
});

it("a month before the first record is missing, and a month with one account's gap is partial", () => {
  const snapshot = {
    accounts,
    imports: [],
    sources: [
      statement(everyday, "2026-01-02", "2026-03-30", "2026-01-01", "2026-03-31"),
      statement(card, "2026-01-03", "2026-01-29", "2026-01-01", "2026-01-31"),
      statement(card, "2026-03-02", "2026-03-28", "2026-03-01", "2026-03-31"),
    ],
  };
  expect(
    ["2025-12", "2026-01", "2026-02"].map((month) =>
      monthCoverage(snapshot, YearMonth.make(month)),
    ),
  ).toEqual(["missing", "complete", "partial"]);
});

it("a period names the days each account has no records for", () => {
  const coverage = accountCoverage(
    {
      accounts,
      imports: [],
      sources: [
        // Stops on 20 March.
        records(everyday, "2025-07-01", "2026-03-20"),
        // No March statement, but records before and after it.
        statement(card, "2026-01-02", "2026-02-27", "2026-01-01", "2026-02-28"),
        statement(card, "2026-04-02", "2026-04-29", "2026-04-01", "2026-04-30"),
      ],
    },
    march2026,
  );
  expect(periodGaps(coverage, march2026)).toEqual([
    {
      account: { id: everyday.id, kind: "deposit", label: "Everyday", currency: "AUD" },
      missing: [{ start: "2026-03-21", endExclusive: "2026-04-01" }],
    },
    {
      account: { id: card.id, kind: "card", label: "Everyday card", currency: "AUD" },
      missing: [march2026],
    },
  ]);
});

it("a card whose latest statement is not in yet is named, and its months are partial", () => {
  const snapshot = {
    accounts,
    imports: [],
    sources: [
      statement(everyday, "2026-06-02", "2026-09-29", "2026-06-01", "2026-09-30"),
      statement(card, "2026-06-12", "2026-07-10", "2026-06-12", "2026-07-11"),
      // The statement runs past its last transaction, on 31 July, to 11 August.
      statement(card, "2026-07-14", "2026-07-31", "2026-07-12", "2026-08-11"),
    ],
  };
  const gaps = (month: string) => {
    const period = monthsPeriod(YearMonth.make(month));
    return periodGaps(accountCoverage(snapshot, period), period);
  };
  expect(
    ["2026-07", "2026-08", "2026-09"].map((month) =>
      monthCoverage(snapshot, YearMonth.make(month)),
    ),
  ).toEqual(["complete", "partial", "partial"]);
  expect(gaps("2026-08")).toMatchObject([
    { account: { id: card.id }, missing: [{ start: "2026-08-12", endExclusive: "2026-09-01" }] },
  ]);
  expect(gaps("2026-09")).toMatchObject([
    { account: { id: card.id }, missing: [{ start: "2026-09-01", endExclusive: "2026-10-01" }] },
  ]);
});

it("over a year, an account opened partway through lacks only the days of its first month", () => {
  const snapshot = {
    accounts,
    imports: [],
    sources: [
      // Records without a balance check still count as records.
      records(everyday, "2025-01-01", "2025-12-31"),
      records(card, "2025-06-03", "2025-12-31"),
    ],
  };
  const year = { start: day("2025-01-01"), endExclusive: day("2026-01-01") };
  expect(periodGaps(accountCoverage(snapshot, year), year)).toMatchObject([
    { account: { id: card.id }, missing: [{ start: "2025-06-01", endExclusive: "2025-06-03" }] },
  ]);
  expect(
    ["2025-05", "2025-06", "2025-07"].map((month) =>
      monthCoverage(snapshot, YearMonth.make(month)),
    ),
  ).toEqual(["complete", "partial", "complete"]);
});

it("a period every account covers has no gaps", () => {
  const coverage = accountCoverage(
    {
      accounts,
      imports: [],
      sources: [
        records(everyday, "2025-07-01", "2026-04-30"),
        statement(card, "2026-03-03", "2026-03-30", "2026-03-01", "2026-03-31"),
      ],
    },
    march2026,
  );
  expect(periodGaps(coverage, march2026)).toEqual([]);
});
