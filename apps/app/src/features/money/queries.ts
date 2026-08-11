import {
  AccountBalance,
  BankAccount,
  BankImportHistoryItem,
  CategorizationReviewItem,
  Category,
  MoneyAnalysis,
  type CalendarMonth,
} from "@ironcage/domain";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import { readStaleTime, unwrap } from "@/data/core-call";
import { keys } from "@/data/keys";
import {
  getAccountBalances,
  getCategorizationReview,
  getImportHistory,
  getMoneyAnalysis,
  listBankAccounts,
  listCategories,
} from "@/server/money";

export const accountsQuery = queryOptions({
  queryKey: keys.moneyAccounts(),
  queryFn: () => listBankAccounts(),
  select: unwrap(Schema.Array(BankAccount)),
  staleTime: readStaleTime,
});

export const analysisQuery = (startMonth: CalendarMonth, endMonth: CalendarMonth) =>
  queryOptions({
    queryKey: keys.moneyAnalysis(startMonth, endMonth),
    queryFn: () => getMoneyAnalysis({ data: { startMonth, endMonth } }),
    select: unwrap(MoneyAnalysis),
    staleTime: readStaleTime,
  });

export const balancesQuery = queryOptions({
  queryKey: keys.moneyBalances(),
  queryFn: () => getAccountBalances(),
  select: unwrap(Schema.Array(AccountBalance)),
  staleTime: readStaleTime,
});

export const importHistoryQuery = queryOptions({
  queryKey: keys.moneyImportHistory(),
  queryFn: () => getImportHistory(),
  select: unwrap(Schema.Array(BankImportHistoryItem)),
  staleTime: readStaleTime,
});

export const categoriesQuery = queryOptions({
  queryKey: keys.moneyCategories(),
  queryFn: () => listCategories(),
  select: unwrap(Schema.Array(Category)),
  staleTime: readStaleTime,
});

export const reviewQueueQuery = queryOptions({
  queryKey: keys.moneyReview(),
  queryFn: () => getCategorizationReview(),
  select: unwrap(Schema.Array(CategorizationReviewItem)),
  staleTime: readStaleTime,
});
