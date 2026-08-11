import {
  CategorizationRule,
  Category,
  MonthlySpendingReport,
  type BankTransactionRecord,
} from "@ironcage/domain";
import { Effect, Layer, Ref, Schema } from "effect";

import { MoneyBlobStore } from "../../src/money/blob-store";
import { MoneyCryptography } from "../../src/money/crypto";
import { MoneyLedger } from "../../src/money/ledger";
import {
  type CategorizePlan,
  type MoneyLedgerSnapshot,
  MoneyLedgerRepository,
} from "../../src/money/ledger-repository";

export interface MemoryLedgerState {
  readonly snapshot: MoneyLedgerSnapshot;
  readonly categorizeCommits: number;
  readonly reportCommits: number;
}

const request = (
  plan: {
    readonly requestId: CategorizePlan["requestId"];
    readonly payloadHash: CategorizePlan["payloadHash"];
  },
  operation: string,
  response: unknown,
) => ({
  requestId: plan.requestId,
  operation,
  payloadHash: plan.payloadHash,
  response,
});

export const makeMoneyLedgerTestKit = (snapshot: MoneyLedgerSnapshot) =>
  Effect.gen(function* () {
    const state = yield* Ref.make<MemoryLedgerState>({
      snapshot,
      categorizeCommits: 0,
      reportCommits: 0,
    });
    const blobs = yield* Ref.make(new Map<string, string>());

    const repository = MoneyLedgerRepository.of({
      snapshot: Ref.get(state).pipe(Effect.map((current) => current.snapshot)),
      transactions: (_ids) => Effect.succeed<readonly BankTransactionRecord[]>([]),
      withTransaction: (use) =>
        use({
          snapshot: Ref.get(state).pipe(Effect.map((current) => current.snapshot)),
          createCategory: (plan) =>
            Ref.update(state, (current) => ({
              ...current,
              snapshot: {
                ...current.snapshot,
                categories: [...current.snapshot.categories, plan.response],
                requests: [
                  ...current.snapshot.requests,
                  request(
                    plan,
                    "money.create_category",
                    Schema.encodeSync(Category)(plan.response),
                  ),
                ],
              },
            })).pipe(Effect.as(plan.response)),
          renameCategory: (plan) =>
            Ref.update(state, (current) => ({
              ...current,
              snapshot: {
                ...current.snapshot,
                categories: current.snapshot.categories.map((category) =>
                  category.id === plan.response.id ? plan.response : category,
                ),
                requests: [
                  ...current.snapshot.requests,
                  request(
                    plan,
                    "money.rename_category",
                    Schema.encodeSync(Category)(plan.response),
                  ),
                ],
              },
            })).pipe(Effect.as(plan.response)),
          categorize: (plan) =>
            Ref.update(state, (current) => {
              const categories = new Map(
                current.snapshot.categories.map((category) => [category.id, category]),
              );
              const classifications = new Map(
                plan.classifications.map((classification) => [
                  classification.transactionId,
                  classification,
                ]),
              );
              return {
                ...current,
                categorizeCommits: current.categorizeCommits + 1,
                snapshot: {
                  ...current.snapshot,
                  analysis: {
                    ...current.snapshot.analysis,
                    transactions: current.snapshot.analysis.transactions.map((transaction) => {
                      const classification = classifications.get(transaction.id);
                      return classification === undefined
                        ? transaction
                        : {
                            ...transaction,
                            splits: classification.splits.map((split) => {
                              const category = categories.get(split.categoryId)!;
                              return {
                                categoryId: category.id,
                                categoryName: category.name,
                                categoryKind: category.kind,
                                amount: split.amount,
                              };
                            }),
                          };
                    }),
                  },
                  review: current.snapshot.review.filter(
                    (item) => !classifications.has(item.transactionId),
                  ),
                  requests: [
                    ...current.snapshot.requests,
                    request(plan, "money.categorize_transactions", plan.response),
                  ],
                },
              };
            }).pipe(Effect.as(plan.response)),
          editRule: (plan) =>
            Ref.update(state, (current) => ({
              ...current,
              snapshot: {
                ...current.snapshot,
                rules: [
                  ...current.snapshot.rules.filter((rule) => rule.id !== plan.response.id),
                  plan.response,
                ],
                requests: [
                  ...current.snapshot.requests,
                  request(
                    plan,
                    "money.edit_categorization_rule",
                    Schema.encodeSync(CategorizationRule)(plan.response),
                  ),
                ],
              },
            })).pipe(Effect.as(plan.response)),
          resolveTransfer: (plan) =>
            Ref.update(state, (current) => {
              const selected = current.snapshot.transfers.find(
                (transfer) => transfer.id === plan.transferId,
              )!;
              const resolvedIds =
                plan.decision === "confirmed"
                  ? new Set([selected.debitTransactionId, selected.creditTransactionId])
                  : new Set<string>();

              return {
                ...current,
                snapshot: {
                  ...current.snapshot,
                  transfers: current.snapshot.transfers.filter(
                    (transfer) =>
                      transfer.id !== plan.transferId &&
                      !resolvedIds.has(transfer.debitTransactionId) &&
                      !resolvedIds.has(transfer.creditTransactionId),
                  ),
                  confirmedTransferTransactionIds:
                    plan.decision === "confirmed"
                      ? [
                          ...current.snapshot.confirmedTransferTransactionIds,
                          selected.debitTransactionId,
                          selected.creditTransactionId,
                        ]
                      : current.snapshot.confirmedTransferTransactionIds,
                  requests: [
                    ...current.snapshot.requests,
                    request(plan, "money.resolve_transfer", plan.response),
                  ],
                },
              };
            }).pipe(Effect.as(plan.response)),
          saveReport: (plan) =>
            Ref.update(state, (current) => ({
              ...current,
              reportCommits: current.reportCommits + 1,
              snapshot: {
                ...current.snapshot,
                reports: [...current.snapshot.reports, plan.response],
                requests: [
                  ...current.snapshot.requests,
                  request(
                    plan,
                    "money.generate_monthly_report",
                    Schema.encodeSync(MonthlySpendingReport)(plan.response),
                  ),
                ],
              },
            })).pipe(Effect.as(plan.response)),
          markReportRead: (plan) =>
            Ref.update(state, (current) => ({
              ...current,
              snapshot: {
                ...current.snapshot,
                reports: current.snapshot.reports.map((report) =>
                  report.id === plan.response.id ? plan.response : report,
                ),
                requests: [
                  ...current.snapshot.requests,
                  request(
                    plan,
                    "money.mark_monthly_report_read",
                    Schema.encodeSync(MonthlySpendingReport)(plan.response),
                  ),
                ],
              },
            })).pipe(Effect.as(plan.response)),
        }),
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
      Layer.succeed(MoneyLedgerRepository, repository),
      Layer.succeed(MoneyBlobStore, blobStore),
      MoneyCryptography.layer("test-only-money-identity-key-at-least-32-bytes"),
    );

    return {
      state,
      layer: MoneyLedger.layer.pipe(Layer.provide(dependencies)),
    };
  });
