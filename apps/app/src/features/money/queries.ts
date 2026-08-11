import { BoundaryError } from "@ironcage/contracts/schema";
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

import { keys } from "@/data/keys";
import type { CoreOutcome } from "@/server/money";
import {
  getAccountBalances,
  getCategorizationReview,
  getImportHistory,
  getMoneyAnalysis,
  listBankAccounts,
  listCategories,
} from "@/server/money";

export type BoundaryFailure = typeof BoundaryError.Type;

const decodeError = Schema.decodeSync(BoundaryError);

/**
 * A failure the operator is meant to read, carried as an error React Query can
 * hold. Rendering reaches for `boundaryFailure` rather than stringifying,
 * because "the transaction record changed after preview" is an instruction and
 * `[object Object]` is not.
 */
export class CoreCallFailed extends Error {
  readonly failure: BoundaryFailure;

  constructor(failure: BoundaryFailure) {
    super(failure._tag);
    this.name = "CoreCallFailed";
    this.failure = failure;
  }
}

export const boundaryFailure = (error: unknown) =>
  error instanceof CoreCallFailed ? error.failure : null;

/** Unwraps a server function's outcome, decoding both sides with their schema. */
export const unwrap =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (outcome: CoreOutcome<I>): A => {
    if (!outcome.ok) throw new CoreCallFailed(decodeError(outcome.error));

    return Schema.decodeSync(schema)(outcome.value);
  };

/** Nothing on this surface is safety-critical, so none of it polls. */
const moneyStaleTime = 30_000;

export const accountsQuery = queryOptions({
  queryKey: keys.moneyAccounts(),
  queryFn: () => listBankAccounts(),
  select: unwrap(Schema.Array(BankAccount)),
  staleTime: moneyStaleTime,
});

export const analysisQuery = (startMonth: CalendarMonth, endMonth: CalendarMonth) =>
  queryOptions({
    queryKey: keys.moneyAnalysis(startMonth, endMonth),
    queryFn: () => getMoneyAnalysis({ data: { startMonth, endMonth } }),
    select: unwrap(MoneyAnalysis),
    staleTime: moneyStaleTime,
  });

export const balancesQuery = queryOptions({
  queryKey: keys.moneyBalances(),
  queryFn: () => getAccountBalances(),
  select: unwrap(Schema.Array(AccountBalance)),
  staleTime: moneyStaleTime,
});

export const importHistoryQuery = queryOptions({
  queryKey: keys.moneyImportHistory(),
  queryFn: () => getImportHistory(),
  select: unwrap(Schema.Array(BankImportHistoryItem)),
  staleTime: moneyStaleTime,
});

export const categoriesQuery = queryOptions({
  queryKey: keys.moneyCategories(),
  queryFn: () => listCategories(),
  select: unwrap(Schema.Array(Category)),
  staleTime: moneyStaleTime,
});

export const reviewQueueQuery = queryOptions({
  queryKey: keys.moneyReview(),
  queryFn: () => getCategorizationReview(),
  select: unwrap(Schema.Array(CategorizationReviewItem)),
  staleTime: moneyStaleTime,
});
