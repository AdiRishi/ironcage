export type MoneySection =
  | "accounts"
  | "coverage"
  | "history"
  | "analysis"
  | "categories"
  | "rules"
  | "review"
  | "transfers";

/**
 * The query-key catalog from `docs/technical/11-app.md` §2. Keys are
 * prefix-hierarchical so one feed event can invalidate a whole family:
 * a confirmed import invalidates `["money"]` and every section refetches.
 * Sections for surfaces that are not built yet are added when they are.
 */
export const keys = {
  vitals: () => ["vitals"] as const,
  money: (section: MoneySection) => ["money", section] as const,
  moneyAll: () => ["money"] as const,
} as const;
