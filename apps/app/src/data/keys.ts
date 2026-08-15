import type { LedgerScope } from "@ironcage/contracts/schema";

export type MoneySection =
  | "accounts"
  | "coverage"
  | "history"
  | "analysis"
  | "categories"
  | "rules"
  | "transfers";

export const keys = {
  vitals: () => ["vitals"] as const,
  system: () => ["system"] as const,
  feed: () => ["feed"] as const,
  wealth: () => ["wealth"] as const,
  externalAccounts: () => ["wealth", "external-accounts"] as const,
  reports: () => ["reports"] as const,
  report: (id: string) => ["reports", id] as const,
  money: (section: MoneySection) => ["money", section] as const,
  ledger: (scope: LedgerScope) => ["money", "ledger", scope] as const,
  moneyAll: () => ["money"] as const,
} as const;
