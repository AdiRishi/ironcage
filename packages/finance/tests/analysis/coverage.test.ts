import { expect, it } from "@effect/vitest";
import { type Account, AccountId, CalendarDate, YearMonth } from "@repo/contracts/finance";

import { accountCoverage, comparisonCoverage, monthCoverage } from "../../src/index.ts";

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
