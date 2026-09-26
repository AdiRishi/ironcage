import { AccountId, ImportId, YearMonth } from "@repo/contracts/finance";
import { expect, test } from "vitest";

import { recordLink } from "@/features/analyst/record-link";

const everyday = AccountId.make("00000000-0000-4000-8000-0000000000a0");
const months = (from: string, to: string) =>
  ({ kind: "months", from: YearMonth.make(from), to: YearMonth.make(to) }) as const;

test("a figure opens its screen for the months and comparison it was read for", () => {
  expect(
    recordLink({
      kind: "countedLedger",
      scope: {
        measure: "income",
        category: { kind: "uncategorised" },
        counterparty: { kind: "all" },
      },
      period: months("2026-08", "2026-10"),
      filter: { accountId: everyday },
    }),
  ).toEqual({
    to: "/ledger",
    search: {
      period: "2026-08..2026-10",
      measure: "income",
      category: "uncategorised",
      accountId: everyday,
    },
  });
  expect(
    recordLink({
      kind: "overview",
      period: months("2026-03", "2026-05"),
      comparison: { kind: "previousYear" },
    }),
  ).toEqual({ to: "/", search: { period: "2026-03..2026-05", compare: "lastYear" } });
  expect(recordLink({ kind: "questions", period: months("2026-08", "2026-08") })).toEqual({
    to: "/questions",
    search: { scope: "period", period: "2026-08" },
  });
});

test("the postings an answer read open for the days of its months, even for one file", () => {
  const statement = ImportId.make("00000000-0000-4000-8000-0000000000b3");
  expect(
    recordLink({
      kind: "postingLedger",
      period: months("2026-02", "2026-02"),
      filter: { importId: statement, description: "ROCKPOOL" },
    }),
  ).toEqual({
    to: "/ledger",
    search: {
      period: "2026-02",
      importId: statement,
      description: "ROCKPOOL",
      from: "2026-02-01",
      to: "2026-02-28",
    },
  });
});
