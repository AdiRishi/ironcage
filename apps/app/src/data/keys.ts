import type { CalendarMonth } from "@ironcage/domain";

/**
 * The query-key catalog from `docs/technical/11-app.md` §2. Keys are
 * prefix-hierarchical so one feed event can invalidate a whole family by
 * prefix, which is what keeps the invalidation table in `invalidation.ts` to a
 * handful of entries instead of one per query.
 *
 * Only the families the built surfaces read are listed. A key is added when the
 * surface that reads it is built, not in anticipation of it.
 */
export const keys = {
  vitals: () => ["vitals"] as const,
  money: () => ["money"] as const,
  moneyAccounts: () => ["money", "accounts"] as const,
  moneyAnalysis: (start: CalendarMonth, end: CalendarMonth) =>
    ["money", "analysis", start, end] as const,
  moneyBalances: () => ["money", "balances"] as const,
  moneyCategories: () => ["money", "categories"] as const,
  moneyImportHistory: () => ["money", "imports"] as const,
  moneyReview: () => ["money", "review"] as const,
  moneyRules: () => ["money", "rules"] as const,
  moneyTransfers: () => ["money", "transfers"] as const,
  reports: () => ["reports"] as const,
} as const;

/** Every key family, for the exhaustiveness the invalidation table depends on. */
export type QueryKey = ReturnType<(typeof keys)[keyof typeof keys]>;
