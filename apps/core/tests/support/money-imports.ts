import {
  ArchivedBankStatement,
  BankImportPreview,
  ConfirmedBankImport,
  type BankAccountId,
  type BankImportHistoryItem as BankImportHistoryItemType,
  type BankTransactionId,
} from "@ironcage/domain";
import { Effect, Layer, Ref, Schema } from "effect";

import { MoneyBlobStore } from "../../src/money/blob-store";
import type { CoverageSegment } from "../../src/money/coverage";
import { MoneyCryptography } from "../../src/money/crypto";
import type { StoredTransactionEvidence } from "../../src/money/deduplication";
import { MoneyImports } from "../../src/money/importer";
import {
  type AccountRegistrationOutcome,
  type ConfirmedImportPlan,
  type ImportSnapshot,
  MoneyAccountMissing,
  MoneyImportRepository,
  type StatementArchivePlan,
  type StoredBankAccount,
} from "../../src/money/repository";
import type { StoredRequest } from "../../src/persistence";

export interface MemoryMoneyState {
  readonly accounts: readonly StoredBankAccount[];
  readonly transactions: readonly StoredTransactionEvidence[];
  readonly coverage: readonly CoverageSegment[];
  readonly imports: ImportSnapshot["imports"];
  readonly archives: ImportSnapshot["statementArchives"];
  readonly requests: readonly StoredRequest[];
  readonly transferPairs: ImportSnapshot["transferPairs"];
  readonly history: readonly BankImportHistoryItemType[];
  readonly coverageStatuses: readonly {
    readonly accountId: BankAccountId;
    readonly month: string;
    readonly complete: boolean;
  }[];
  readonly coverageEvents: readonly ("bank_gap_detected" | "bank_gap_closed")[];
  readonly importCommits: number;
}

const initialState: MemoryMoneyState = {
  accounts: [],
  transactions: [],
  coverage: [],
  imports: [],
  archives: [],
  requests: [],
  transferPairs: [],
  history: [],
  coverageStatuses: [],
  coverageEvents: [],
  importCommits: 0,
};

const observationEvidence = (plan: ConfirmedImportPlan, transactionId: BankTransactionId) =>
  plan.observations
    .filter((observation) => observation.transactionId === transactionId)
    .map((observation) => ({
      sourceProfile: plan.sourceProfile,
      bankIdentifier: observation.bankIdentifier,
      rowBalance: observation.rowBalance,
      narrativeFingerprint: observation.narrativeFingerprint,
      equalRowOccurrence: observation.equalRowOccurrence,
    }));

const applyImport = (state: MemoryMoneyState, plan: ConfirmedImportPlan): MemoryMoneyState => {
  const transactions = [...state.transactions];
  const transactionPlans = new Map(
    plan.transactions.map((transaction) => [transaction.id, transaction]),
  );
  const affectedIds = new Set(plan.observations.map((observation) => observation.transactionId));

  for (const transactionId of affectedIds) {
    const index = transactions.findIndex(
      (transaction) => transaction.transactionId === transactionId,
    );
    if (index >= 0) {
      const current = transactions[index]!;
      transactions[index] = {
        ...current,
        observations: [...current.observations, ...observationEvidence(plan, transactionId)],
      };
      continue;
    }

    const transaction = transactionPlans.get(transactionId)!;
    transactions.push({
      transactionId,
      accountId: plan.result.accountId,
      postedDate: transaction.postedDate,
      amount: transaction.amount,
      preferredNarrative: transaction.preferredNarrative,
      observations: observationEvidence(plan, transactionId),
    });
  }

  const history: BankImportHistoryItemType = {
    importId: plan.result.importId,
    accountId: plan.result.accountId,
    profile: plan.sourceProfile,
    bundleDigest: plan.result.bundleDigest,
    window: plan.result.sourceWindow,
    sourceTransactions: plan.result.sourceTransactions,
    observations: plan.result.observations,
    newTransactions: plan.result.newTransactions,
    duplicates: plan.result.duplicates,
    resolvedAmbiguities: plan.result.resolvedAmbiguities,
    confirmedAt: plan.result.confirmedAt,
  };
  const coverageEvents = plan.coverageStatuses.flatMap((status) => {
    const previous = [...state.coverageStatuses]
      .reverse()
      .find(
        (candidate) => candidate.accountId === status.accountId && candidate.month === status.month,
      );
    return previous === undefined && !status.complete
      ? (["bank_gap_detected"] as const)
      : previous?.complete === false && status.complete
        ? (["bank_gap_closed"] as const)
        : [];
  });

  return {
    ...state,
    transactions,
    coverage: [...state.coverage, { accountId: plan.result.accountId, ...plan.coverage }],
    imports: [
      ...state.imports,
      {
        bundleDigest: plan.result.bundleDigest,
        result: Schema.encodeSync(ConfirmedBankImport)(plan.result),
        preview: Schema.encodeSync(BankImportPreview)(plan.preview),
      },
    ],
    requests: [
      ...state.requests,
      {
        requestId: plan.requestId,
        operation: "money.confirm_import",
        payloadHash: plan.requestPayloadHash,
        response: Schema.encodeSync(ConfirmedBankImport)(plan.result),
      },
    ],
    transferPairs: [
      ...state.transferPairs,
      ...plan.transfers.map((transfer) => ({
        debitTransactionId: transfer.debitTransactionId,
        creditTransactionId: transfer.creditTransactionId,
        status: transfer.status,
      })),
    ],
    history: [...state.history, history],
    coverageStatuses: [...state.coverageStatuses, ...plan.coverageStatuses],
    coverageEvents: [...state.coverageEvents, ...coverageEvents],
    importCommits: state.importCommits + 1,
  };
};

export const makeMoneyImportTestKit = Effect.gen(function* () {
  const state = yield* Ref.make(initialState);
  const blobs = yield* Ref.make(new Map<string, string>());

  const snapshot = (accountId: BankAccountId) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(state);
      const selectedAccount = current.accounts.find(
        (candidate) => candidate.account.id === accountId,
      );
      if (selectedAccount === undefined) return yield* new MoneyAccountMissing({ accountId });

      return {
        selectedAccount,
        accounts: current.accounts.map((candidate) => candidate.account),
        transactions: current.transactions,
        coverage: current.coverage,
        rules: [],
        imports: current.imports,
        statementArchives: current.archives,
        requests: current.requests,
        transferPairs: current.transferPairs,
      } satisfies ImportSnapshot;
    });

  const repository = MoneyImportRepository.of({
    listAccounts: Ref.get(state).pipe(
      Effect.map((current) => current.accounts.map((candidate) => candidate.account)),
    ),
    registerAccount: (input): Effect.Effect<AccountRegistrationOutcome> =>
      Ref.modify<MemoryMoneyState, AccountRegistrationOutcome>(state, (current) => {
        const previousRequest = current.requests.find(
          (request) => request.requestId === input.requestId,
        );
        if (previousRequest !== undefined) {
          return [
            previousRequest.operation === "money.register_account" &&
            previousRequest.payloadHash === input.requestPayloadHash
              ? { _tag: "Replay", response: previousRequest.response }
              : {
                  _tag: "RequestConflict",
                  existingPayloadHash: previousRequest.payloadHash,
                },
            current,
          ];
        }
        const accountConflict = current.accounts.find(
          (candidate) =>
            candidate.account.id === input.account.account.id ||
            candidate.account.profile === input.account.account.profile ||
            candidate.account.label === input.account.account.label,
        );
        if (accountConflict !== undefined) {
          return [
            {
              _tag: "AccountConflict",
              field:
                accountConflict.account.id === input.account.account.id
                  ? "id"
                  : accountConflict.account.profile === input.account.account.profile
                    ? "profile"
                    : "label",
              existingAccountId: accountConflict.account.id,
            },
            current,
          ];
        }
        const identity = current.accounts.find(
          (candidate) => candidate.identityHmac === input.account.identityHmac,
        );
        if (identity !== undefined) {
          return [{ _tag: "IdentityConflict", existingAccountId: identity.account.id }, current];
        }
        return [
          { _tag: "Applied", account: input.account.account },
          {
            ...current,
            accounts: [...current.accounts, input.account],
            requests: [
              ...current.requests,
              {
                requestId: input.requestId,
                operation: "money.register_account",
                payloadHash: input.requestPayloadHash,
                response: input.account.account,
              },
            ],
          },
        ];
      }),
    snapshot,
    withAccountTransaction: (accountId, use) =>
      use({
        snapshot: snapshot(accountId),
        commitImport: (plan) =>
          Ref.update(state, (current) => applyImport(current, plan)).pipe(Effect.as(plan.result)),
        commitStatementArchive: (plan: StatementArchivePlan) =>
          Ref.update(state, (current) => ({
            ...current,
            archives: [
              ...current.archives,
              {
                digest: plan.result.digest,
                result: Schema.encodeSync(ArchivedBankStatement)(plan.result),
              },
            ],
            requests: [
              ...current.requests,
              {
                requestId: plan.requestId,
                operation: "money.archive_statement",
                payloadHash: plan.requestPayloadHash,
                response: Schema.encodeSync(ArchivedBankStatement)(plan.result),
              },
            ],
          })).pipe(Effect.as(plan.result)),
      }),
    importHistory: (accountId) =>
      Ref.get(state).pipe(
        Effect.map((current) =>
          current.history.filter((item) => accountId === null || item.accountId === accountId),
        ),
      ),
  });
  const blobStore = MoneyBlobStore.of({
    putImmutable: ({ key, bytes }) =>
      Ref.update(blobs, (current) => {
        const next = new Map(current);
        next.set(key, new TextDecoder().decode(bytes));
        return next;
      }),
    getText: (key) => Ref.get(blobs).pipe(Effect.map((current) => current.get(key) ?? null)),
  });
  const dependencies = Layer.mergeAll(
    Layer.succeed(MoneyImportRepository, repository),
    Layer.succeed(MoneyBlobStore, blobStore),
    MoneyCryptography.layer("test-only-money-identity-key-at-least-32-bytes"),
  );

  return {
    state,
    layer: MoneyImports.layer.pipe(Layer.provide(dependencies)),
  };
});
