import { CalendarDate, type ContributorsResult } from "@repo/contracts/finance";

import { defaultAnalysis } from "@/features/analysis/search";

export function contributorsResult(minor: bigint): ContributorsResult {
  const money = { kind: "money", amount: { currency: "AUD", minor } } as const;
  const period = {
    period: {
      start: CalendarDate.make("2026-08-01"),
      endExclusive: CalendarDate.make("2026-09-01"),
    },
    basis: "spending",
    total: money,
    value: money,
    days: 31,
    purchaseCount: 0,
    averagePurchase: null,
    coverage: {
      accounts: [],
      unresolvedCount: 0,
      unresolvedAmount: { currency: "AUD", minor: 0n },
      unlinkedCredits: { currency: "AUD", minor: 0n },
    },
  } as const;
  return {
    comparison: {
      query: defaultAnalysis,
      accountIds: [],
      calculatedAt: "2026-09-01T00:00:00.000Z",
      calculationVersion: "1",
      current: period,
      previous: period,
      delta: { kind: "money", amount: { currency: "AUD", minor: 0n } },
      relativeChange: "0",
    },
    groupBy: "merchant",
    rows: [],
    remainder: null,
    overlap: false,
  };
}
