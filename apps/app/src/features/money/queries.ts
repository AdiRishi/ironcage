import {
  BankAccountSummary,
  BankCoverage,
  CategorySummary,
  ImportHistoryEntry,
  MoneyAnalysis,
  ReviewQueueEntry,
  RuleSummary,
} from "@ironcage/contracts/schema";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import { keys } from "@/data/keys";
import { TransferMatches } from "@/features/money/codec";
import {
  getBankAccounts,
  getBankCoverage,
  getCategorizationRules,
  getImportHistory,
  getMoneyAnalysis,
  getReviewQueue,
  getTransferMatches,
  listCategories,
} from "@/server/money";

/**
 * One `queryOptions` per Money section: routes prefetch these in loaders and
 * components subscribe to the same cache entries. Server functions return the
 * encoded form, so `select` is where wire data becomes domain values —
 * `BigDecimal` amounts, branded ids — exactly once per cache entry.
 */

export const accountsQuery = queryOptions({
  queryKey: keys.money("accounts"),
  queryFn: () => getBankAccounts(),
  select: Schema.decodeSync(Schema.Array(BankAccountSummary)),
});

export const coverageQuery = queryOptions({
  queryKey: keys.money("coverage"),
  queryFn: () => getBankCoverage(),
  select: Schema.decodeSync(BankCoverage),
});

export const historyQuery = queryOptions({
  queryKey: keys.money("history"),
  queryFn: () => getImportHistory(),
  select: Schema.decodeSync(Schema.Array(ImportHistoryEntry)),
});

export const analysisQuery = queryOptions({
  queryKey: keys.money("analysis"),
  queryFn: () => getMoneyAnalysis(),
  select: Schema.decodeSync(MoneyAnalysis),
});

export const categoriesQuery = queryOptions({
  queryKey: keys.money("categories"),
  queryFn: () => listCategories(),
  select: Schema.decodeSync(Schema.Array(CategorySummary)),
});

export const rulesQuery = queryOptions({
  queryKey: keys.money("rules"),
  queryFn: () => getCategorizationRules(),
  select: Schema.decodeSync(Schema.Array(RuleSummary)),
});

export const reviewQuery = queryOptions({
  queryKey: keys.money("review"),
  queryFn: () => getReviewQueue(),
  select: Schema.decodeSync(Schema.Array(ReviewQueueEntry)),
});

export const transfersQuery = queryOptions({
  queryKey: keys.money("transfers"),
  queryFn: () => getTransferMatches(),
  select: Schema.decodeSync(TransferMatches),
});
