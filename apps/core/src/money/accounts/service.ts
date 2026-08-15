import {
  BankAccountSummary,
  Conflict,
  Internal,
  NotFound,
  type BankCoverage,
  type ImportHistoryEntry,
} from "@ironcage/contracts/schema";
import { BankAccountId, type CalendarDate, type RequestId, type Sha256 } from "@ironcage/domain";
import { Effect } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";
import { completeMonths, coverageGaps, mergeSpans, monthsBetween } from "../import/coverage";
import { latestConfirmedAt, listImportHistory, loadCoverageSpans } from "../import/repository";
import { insertAccount, listAccounts, type AccountRow } from "./repository";

const summarize = (account: AccountRow): BankAccountSummary => ({
  id: account.id,
  productLabel: account.productLabel,
  accountType: account.accountType,
  maskedSuffix: account.maskedSuffix,
  identityBound: account.identityHmac !== null,
  required: account.required,
  openedOn: account.openedOn,
  closedOn: account.closedOn,
});

export const getBankAccounts = (): Effect.Effect<
  readonly BankAccountSummary[],
  NotFound | Internal,
  Postgres
> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const accounts = yield* postgres.readTransaction((sql) => listAccounts(sql));
    return accounts.map(summarize);
  }).pipe(persistenceToBoundary);

export interface ConfigureBankAccountInput {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly productLabel: string;
  readonly accountType: AccountRow["accountType"];
  readonly required: boolean;
  readonly openedOn: CalendarDate | null;
  readonly closedOn: CalendarDate | null;
}

export const configureBankAccount = (input: ConfigureBankAccountInput) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "configureBankAccount",
      payloadHash: input.payloadHash,
      response: BankAccountSummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const existing = yield* listAccounts(sql);
        if (existing.some((account) => account.productLabel === input.productLabel)) {
          return yield* Effect.fail(
            new Conflict({
              reason: "DuplicateAccountLabel",
              detail: `an account named "${input.productLabel}" already exists`,
            }),
          );
        }

        const account: AccountRow = {
          id: yield* mintId(BankAccountId),
          bank: "cba",
          productLabel: input.productLabel,
          accountType: input.accountType,
          maskedSuffix: null,
          identityHmac: null,
          currency: "AUD",
          required: input.required,
          openedOn: input.openedOn,
          closedOn: input.closedOn,
        };
        yield* insertAccount(sql, account);
        return summarize(account);
      }),
  );

export const getBankCoverage = (): Effect.Effect<BankCoverage, NotFound | Internal, Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;

    return yield* postgres.readTransaction((sql) =>
      Effect.gen(function* () {
        const summary = yield* loadCoverageSummary(sql);

        return {
          accounts: summary.perAccount.map(({ account, covered, gaps }) => ({
            account: summarize(account),
            covered,
            gaps,
          })),
          completeMonths: summary.completeMonths,
          freshestImportAt: yield* latestConfirmedAt(sql),
          dataThrough: summary.dataThrough,
        };
      }),
    );
  }).pipe(persistenceToBoundary);

/**
 * The whole-of-Money coverage view: per-account merged spans and gaps, the
 * complete-month intersection across required accounts, and the honest
 * data-through date (the latest day every required account covers).
 */
export const loadCoverageSummary = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const accounts = yield* listAccounts(sql);
    const perAccount = yield* Effect.forEach(accounts, (account) =>
      Effect.map(loadCoverageSpans(sql, account.id), (spans) => {
        const covered = mergeSpans(spans);
        const gaps =
          covered.length === 0
            ? []
            : coverageGaps(covered, {
                start: covered[0]!.start,
                end: covered[covered.length - 1]!.end,
              });
        return { account, covered, gaps };
      }),
    );

    const required = perAccount.filter(({ account }) => account.required);
    const bounds = required.flatMap(({ covered }) =>
      covered.length === 0 ? [] : [covered[0]!.start, covered[covered.length - 1]!.end],
    );
    const anyUncovered = required.some(({ covered }) => covered.length === 0);
    const months =
      required.length === 0 || anyUncovered || bounds.length === 0
        ? new Set<string>()
        : completeMonths(
            required.map(({ account, covered }) => ({
              merged: covered,
              life: { openedOn: account.openedOn, closedOn: account.closedOn },
            })),
            monthsBetween(
              bounds.reduce((a, b) => (a < b ? a : b)),
              bounds.reduce((a, b) => (a > b ? a : b)),
            ),
          );

    const ends = required.map(({ covered }) => covered[covered.length - 1]?.end);
    const dataThrough =
      ends.length === 0 || ends.some((end) => end === undefined)
        ? null
        : ends.reduce<CalendarDate>((a, b) => (a < b! ? a : b!), "9999-12-31" as CalendarDate);

    return { perAccount, completeMonths: [...months].sort(), dataThrough };
  });

export const getImportHistory = (): Effect.Effect<
  readonly ImportHistoryEntry[],
  NotFound | Internal,
  Postgres
> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const rows = yield* postgres.readTransaction((sql) => listImportHistory(sql));

    return rows.map((row) => ({
      importId: row.importId,
      accountId: row.accountId,
      productLabel: row.productLabel,
      sourceProfile: row.sourceProfile,
      window: { start: row.windowStart, end: row.windowEnd },
      effects: row.effects,
      files: row.files,
      confirmedAt: row.confirmedAt,
    }));
  }).pipe(persistenceToBoundary);
