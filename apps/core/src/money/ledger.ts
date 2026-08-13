import { Conflict, Internal, NotFound, Stale, ValidationFailed } from "@ironcage/contracts/schema";
import {
  AccountBalance,
  BankTransactionRecord,
  CalendarDate,
  CalendarMonth,
  CategorizationRule,
  CategorizationRuleId,
  Category,
  CategoryId,
  FeedEventId,
  formatMoney,
  MoneyAnalysis,
  MonthlySpendingReport,
  ReportId,
  RequestId,
  TransactionClassificationId,
  TransactionSplitId,
  TransferCandidate,
  type BankAccountId,
  type BankTransactionId,
  type CategorizationReviewItem,
  type CategorizationRulePredicate,
  type CategorizeTransaction,
  type CategoryKind,
  type CategorySplit,
  type Sha256,
  type TransferMatchId,
} from "@ironcage/domain";
import { BigDecimal, Context, DateTime, Effect, Layer, Schema } from "effect";

import type { PersistenceError } from "../persistence";
import { analyzeMoney } from "./analysis";
import { MoneyBlobStore } from "./blob-store";
import { infrastructureError, type MoneyBoundaryError, replayRequest } from "./boundary";
import { calendarMonthWindow, coverageGaps } from "./coverage";
import { canonicalJson, mintUuidV7, MoneyCryptography, sha256Text } from "./crypto";
import { MoneyLedgerRepository, type MoneyLedgerSnapshot } from "./ledger-repository";
import { normalizeNarrative } from "./normalization";
import { renderMonthlySpendingReport } from "./report";

const MutationResult = Schema.Struct({ requestId: RequestId });
const normalizedName = (name: string) => name.trim();
const categoryNameKey = (name: string) =>
  normalizedName(name).normalize("NFKC").toLocaleLowerCase("en-AU");
const ledgerBoundaryError = (error: PersistenceError | MoneyBoundaryError) =>
  error._tag === "PersistenceError" ? infrastructureError(error) : error;

const payloadDigest = (
  cryptography: MoneyCryptography["Service"],
  value: Parameters<typeof canonicalJson>[0],
) => sha256Text(cryptography, canonicalJson(value)).pipe(Effect.mapError(infrastructureError));

const requireName = (name: string) =>
  normalizedName(name).length === 0
    ? Effect.fail(new ValidationFailed({ reason: "EmptyName", detail: "a name must contain text" }))
    : Effect.succeed(normalizedName(name));

const requireUniqueCategoryName = (
  categories: readonly Category[],
  name: string,
  except: CategoryId | null,
) =>
  categories.some(
    (category) =>
      category.id !== except && categoryNameKey(category.name) === categoryNameKey(name),
  )
    ? Effect.fail(
        new Conflict({
          reason: "CategoryNameAlreadyExists",
          detail: `a category named ${name} already exists`,
        }),
      )
    : Effect.void;

const categoryById = (snapshot: MoneyLedgerSnapshot, id: CategoryId) =>
  snapshot.categories.find((category) => category.id === id);

const ruleById = (snapshot: MoneyLedgerSnapshot, id: CategorizationRuleId) =>
  snapshot.rules.find((rule) => rule.id === id);

const replay = <A>(input: {
  readonly snapshot: MoneyLedgerSnapshot;
  readonly requestId: RequestId;
  readonly operation: string;
  readonly payloadHash: Sha256;
  readonly schema: Schema.Decoder<A>;
}) => replayRequest({ requests: input.snapshot.requests, ...input });

const splitEvidence = (splits: readonly CategorySplit[]) =>
  [...splits]
    .sort((left, right) => left.categoryId.localeCompare(right.categoryId))
    .map((split) => ({
      categoryId: split.categoryId,
      amount: formatMoney(split.amount),
    }));

const sameSplits = (left: readonly CategorySplit[], right: readonly CategorySplit[]) => {
  const leftEvidence = splitEvidence(left);
  const rightEvidence = splitEvidence(right);
  return (
    leftEvidence.length === rightEvidence.length &&
    leftEvidence.every(
      (split, index) =>
        split.categoryId === rightEvidence[index]?.categoryId &&
        split.amount === rightEvidence[index]?.amount,
    )
  );
};

const validateAssignment = (snapshot: MoneyLedgerSnapshot, assignment: CategorizeTransaction) =>
  Effect.gen(function* () {
    const transaction = snapshot.analysis.transactions.find(
      (candidate) => candidate.id === assignment.transactionId,
    );
    if (transaction === undefined) {
      return yield* new NotFound({ entity: "bank transaction", id: assignment.transactionId });
    }

    const categoryIds = new Set(assignment.splits.map((split) => split.categoryId));
    if (categoryIds.size !== assignment.splits.length) {
      return yield* new ValidationFailed({
        reason: "DuplicateCategorySplit",
        detail: `${assignment.transactionId} contains the same category more than once`,
      });
    }
    const missingCategory = assignment.splits.find(
      (split) => categoryById(snapshot, split.categoryId) === undefined,
    );
    if (missingCategory !== undefined) {
      return yield* new NotFound({ entity: "money category", id: missingCategory.categoryId });
    }

    const total = BigDecimal.sumAll(assignment.splits.map((split) => split.amount));
    if (!BigDecimal.equals(total, transaction.amount)) {
      return yield* new ValidationFailed({
        reason: "UnbalancedTransactionSplits",
        detail: `${assignment.transactionId} splits total ${BigDecimal.format(total)} instead of ${formatMoney(transaction.amount)}`,
      });
    }

    const review = snapshot.review.find((item) => item.transactionId === assignment.transactionId);
    if (assignment.acceptedSuggestionId !== null) {
      if (
        review?.suggestion === null ||
        review?.suggestion === undefined ||
        review.suggestion.id !== assignment.acceptedSuggestionId ||
        !sameSplits(review.suggestion.splits, assignment.splits)
      ) {
        return yield* new ValidationFailed({
          reason: "SuggestionDoesNotMatchAssignment",
          detail: `the accepted suggestion does not exactly match ${assignment.transactionId}`,
        });
      }
    }

    return transaction;
  });

const predicateEvidence = (predicate: CategorizationRulePredicate) => ({
  accountIds: [...predicate.accountIds].sort((left, right) => left.localeCompare(right)),
  direction: predicate.direction,
  payeeEquals: predicate.payeeEquals,
  narrativeIncludes: [...predicate.narrativeIncludes].sort((left, right) =>
    left.localeCompare(right),
  ),
  minimumAbsoluteAmount:
    predicate.minimumAbsoluteAmount === null ? null : formatMoney(predicate.minimumAbsoluteAmount),
  maximumAbsoluteAmount:
    predicate.maximumAbsoluteAmount === null ? null : formatMoney(predicate.maximumAbsoluteAmount),
});

const validatePredicate = (snapshot: MoneyLedgerSnapshot, predicate: CategorizationRulePredicate) =>
  Effect.gen(function* () {
    if (
      (predicate.payeeEquals !== null && predicate.payeeEquals.trim().length === 0) ||
      predicate.narrativeIncludes.some((token) => token.trim().length === 0)
    ) {
      return yield* new ValidationFailed({
        reason: "EmptyRuleText",
        detail: "rule payee and narrative terms must contain text",
      });
    }
    if (new Set(predicate.accountIds).size !== predicate.accountIds.length) {
      return yield* new ValidationFailed({
        reason: "DuplicateRuleAccount",
        detail: "a rule may name each account once",
      });
    }
    const narrativeTerms = predicate.narrativeIncludes.map(normalizeNarrative);
    if (new Set(narrativeTerms).size !== narrativeTerms.length) {
      return yield* new ValidationFailed({
        reason: "DuplicateRuleTerm",
        detail: "a rule may name each narrative term once",
      });
    }
    const knownAccountIds = new Set(snapshot.analysis.accounts.map((account) => account.id));
    const missingAccount = predicate.accountIds.find(
      (accountId) => !knownAccountIds.has(accountId),
    );
    if (missingAccount !== undefined) {
      return yield* new NotFound({ entity: "bank account", id: missingAccount });
    }
    if (
      predicate.minimumAbsoluteAmount !== null &&
      BigDecimal.sign(predicate.minimumAbsoluteAmount) < 0
    ) {
      return yield* new ValidationFailed({
        reason: "NegativeRuleMinimum",
        detail: "rule amount bounds are absolute values",
      });
    }
    if (
      predicate.maximumAbsoluteAmount !== null &&
      BigDecimal.sign(predicate.maximumAbsoluteAmount) < 0
    ) {
      return yield* new ValidationFailed({
        reason: "NegativeRuleMaximum",
        detail: "rule amount bounds are absolute values",
      });
    }
    if (
      predicate.minimumAbsoluteAmount !== null &&
      predicate.maximumAbsoluteAmount !== null &&
      BigDecimal.isGreaterThan(predicate.minimumAbsoluteAmount, predicate.maximumAbsoluteAmount)
    ) {
      return yield* new ValidationFailed({
        reason: "InvalidRuleAmountRange",
        detail: "the minimum amount cannot exceed the maximum amount",
      });
    }
  });

const anomalyTransactionIds = (analysis: MoneyAnalysis) =>
  analysis.anomalies.flatMap((anomaly) =>
    anomaly._tag === "CategorySpike" ? [] : [anomaly.transactionId],
  );

export class MoneyLedger extends Context.Service<
  MoneyLedger,
  {
    readonly coverage: (
      start: CalendarDate,
      end: CalendarDate,
    ) => Effect.Effect<
      readonly { accountId: BankAccountId; start: CalendarDate; end: CalendarDate }[],
      MoneyBoundaryError
    >;
    readonly listCategories: Effect.Effect<readonly Category[], MoneyBoundaryError>;
    readonly createCategory: (input: {
      readonly id: CategoryId;
      readonly name: string;
      readonly kind: CategoryKind;
      readonly requestId: RequestId;
    }) => Effect.Effect<Category, MoneyBoundaryError>;
    readonly renameCategory: (input: {
      readonly id: CategoryId;
      readonly expectedVersion: number;
      readonly name: string;
      readonly requestId: RequestId;
    }) => Effect.Effect<Category, MoneyBoundaryError>;
    readonly categorizationReview: Effect.Effect<
      readonly CategorizationReviewItem[],
      MoneyBoundaryError
    >;
    readonly categorize: (input: {
      readonly assignments: readonly CategorizeTransaction[];
      readonly requestId: RequestId;
    }) => Effect.Effect<{ readonly requestId: RequestId }, MoneyBoundaryError>;
    readonly rules: Effect.Effect<readonly CategorizationRule[], MoneyBoundaryError>;
    readonly editRule: (input: {
      readonly id: CategorizationRuleId | null;
      readonly expectedVersion: number | null;
      readonly name: string;
      readonly predicate: CategorizationRulePredicate;
      readonly categoryId: CategoryId;
      readonly effectiveFrom: CalendarDate;
      readonly retired: boolean;
      readonly requestId: RequestId;
    }) => Effect.Effect<CategorizationRule, MoneyBoundaryError>;
    readonly transferReview: Effect.Effect<readonly TransferCandidate[], MoneyBoundaryError>;
    readonly resolveTransfer: (input: {
      readonly id: TransferMatchId;
      readonly decision: "confirmed" | "rejected";
      readonly requestId: RequestId;
    }) => Effect.Effect<{ readonly requestId: RequestId }, MoneyBoundaryError>;
    readonly analyze: (
      startMonth: CalendarMonth,
      endMonth: CalendarMonth,
    ) => Effect.Effect<MoneyAnalysis, MoneyBoundaryError>;
    readonly balances: Effect.Effect<readonly AccountBalance[], MoneyBoundaryError>;
    readonly transactions: (
      ids: readonly BankTransactionId[],
    ) => Effect.Effect<readonly BankTransactionRecord[], MoneyBoundaryError>;
    readonly generateReport: (input: {
      readonly month: CalendarMonth;
      readonly requestId: RequestId;
    }) => Effect.Effect<MonthlySpendingReport, MoneyBoundaryError>;
    readonly listReports: Effect.Effect<readonly MonthlySpendingReport[], MoneyBoundaryError>;
    readonly markReportRead: (input: {
      readonly id: ReportId;
      readonly requestId: RequestId;
    }) => Effect.Effect<MonthlySpendingReport, MoneyBoundaryError>;
    readonly getReport: (
      id: ReportId,
    ) => Effect.Effect<
      { readonly report: MonthlySpendingReport; readonly html: string },
      MoneyBoundaryError
    >;
  }
>()("ironcage/core/money/MoneyLedger") {
  static readonly layer = Layer.effect(
    MoneyLedger,
    Effect.gen(function* () {
      const repository = yield* MoneyLedgerRepository;
      const cryptography = yield* MoneyCryptography;
      const blobs = yield* MoneyBlobStore;

      const readSnapshot = repository.snapshot.pipe(Effect.mapError(infrastructureError));

      const coverage = Effect.fn("MoneyLedger.coverage")(function* (
        start: CalendarDate,
        end: CalendarDate,
      ): Effect.fn.Return<
        readonly { accountId: BankAccountId; start: CalendarDate; end: CalendarDate }[],
        MoneyBoundaryError
      > {
        if (start > end) {
          return yield* new ValidationFailed({
            reason: "InvalidCoverageWindow",
            detail: "the coverage start must not be after its end",
          });
        }
        const snapshot = yield* readSnapshot;
        return coverageGaps(snapshot.analysis.accounts, snapshot.analysis.coverage, { start, end });
      });

      const createCategory = Effect.fn("MoneyLedger.createCategory")(function* (input: {
        readonly id: CategoryId;
        readonly name: string;
        readonly kind: CategoryKind;
        readonly requestId: RequestId;
      }): Effect.fn.Return<Category, MoneyBoundaryError> {
        const name = yield* requireName(input.name);
        const payloadHash = yield* payloadDigest(cryptography, {
          id: input.id,
          name,
          kind: input.kind,
        });

        return yield* repository
          .withTransaction(input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const previous = yield* replay({
                snapshot,
                requestId: input.requestId,
                operation: "money.create_category",
                payloadHash,
                schema: Category,
              });
              if (previous !== null) return previous;
              if (categoryById(snapshot, input.id) !== undefined) {
                return yield* new Conflict({
                  reason: "CategoryIdAlreadyExists",
                  detail: `${input.id} already identifies a category`,
                });
              }
              yield* requireUniqueCategoryName(snapshot.categories, name, null);
              const category: Category = {
                id: input.id,
                version: 1,
                name,
                kind: input.kind,
                system: false,
              };
              return yield* transaction.createCategory({
                requestId: input.requestId,
                payloadHash,
                response: category,
              });
            }),
          )
          .pipe(Effect.mapError(ledgerBoundaryError));
      });

      const renameCategory = Effect.fn("MoneyLedger.renameCategory")(function* (input: {
        readonly id: CategoryId;
        readonly expectedVersion: number;
        readonly name: string;
        readonly requestId: RequestId;
      }): Effect.fn.Return<Category, MoneyBoundaryError> {
        const name = yield* requireName(input.name);
        const payloadHash = yield* payloadDigest(cryptography, {
          id: input.id,
          expectedVersion: input.expectedVersion,
          name,
        });

        return yield* repository
          .withTransaction(input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const previous = yield* replay({
                snapshot,
                requestId: input.requestId,
                operation: "money.rename_category",
                payloadHash,
                schema: Category,
              });
              if (previous !== null) return previous;
              const current = categoryById(snapshot, input.id);
              if (current === undefined) {
                return yield* new NotFound({ entity: "money category", id: input.id });
              }
              if (current.system) {
                return yield* new ValidationFailed({
                  reason: "SystemCategoryImmutable",
                  detail: `${current.name} is owned by the system`,
                });
              }
              if (current.version !== input.expectedVersion) {
                return yield* new Stale({
                  reason: "CategoryVersionChanged",
                  detail: `${current.name} is now at version ${current.version}`,
                });
              }
              yield* requireUniqueCategoryName(snapshot.categories, name, input.id);
              const renamed: Category = {
                ...current,
                version: current.version + 1,
                name,
              };
              return yield* transaction.renameCategory({
                requestId: input.requestId,
                payloadHash,
                response: renamed,
              });
            }),
          )
          .pipe(Effect.mapError(ledgerBoundaryError));
      });

      const categorize = Effect.fn("MoneyLedger.categorize")(function* (input: {
        readonly assignments: readonly CategorizeTransaction[];
        readonly requestId: RequestId;
      }): Effect.fn.Return<{ readonly requestId: RequestId }, MoneyBoundaryError> {
        const payloadHash = yield* payloadDigest(cryptography, {
          assignments: [...input.assignments]
            .sort((left, right) => left.transactionId.localeCompare(right.transactionId))
            .map((assignment) => ({
              transactionId: assignment.transactionId,
              splits: splitEvidence(assignment.splits),
              acceptedSuggestionId: assignment.acceptedSuggestionId,
            })),
        });

        return yield* repository
          .withTransaction(input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const previous = yield* replay({
                snapshot,
                requestId: input.requestId,
                operation: "money.categorize_transactions",
                payloadHash,
                schema: MutationResult,
              });
              if (previous !== null) return previous;
              const transactionIds = new Set(
                input.assignments.map((assignment) => assignment.transactionId),
              );
              if (transactionIds.size !== input.assignments.length) {
                return yield* new ValidationFailed({
                  reason: "DuplicateTransactionAssignment",
                  detail: "each transaction may be assigned once per request",
                });
              }
              const transactions = yield* Effect.forEach(input.assignments, (assignment) =>
                validateAssignment(snapshot, assignment),
              );
              const recordedAt = yield* DateTime.now;
              const classifications = yield* Effect.forEach(
                input.assignments,
                (assignment, index) =>
                  Effect.gen(function* () {
                    const classificationId = yield* mintUuidV7(
                      cryptography,
                      TransactionClassificationId,
                    ).pipe(Effect.mapError(infrastructureError));
                    const splits = yield* Effect.forEach(assignment.splits, (split) =>
                      mintUuidV7(cryptography, TransactionSplitId).pipe(
                        Effect.mapError(infrastructureError),
                        Effect.map((id) => ({ id, ...split })),
                      ),
                    );
                    return {
                      id: classificationId,
                      transactionId: assignment.transactionId,
                      provenance:
                        assignment.acceptedSuggestionId === null
                          ? ("manual" as const)
                          : ("ai" as const),
                      sourceId: assignment.acceptedSuggestionId,
                      sourceVersion: null,
                      amount: transactions[index]!.amount,
                      splits,
                      acceptedSuggestionId: assignment.acceptedSuggestionId,
                    };
                  }),
              );
              return yield* transaction.categorize({
                requestId: input.requestId,
                payloadHash,
                response: { requestId: input.requestId },
                classifications,
                recordedAt,
              });
            }),
          )
          .pipe(Effect.mapError(ledgerBoundaryError));
      });

      const editRule = Effect.fn("MoneyLedger.editRule")(function* (input: {
        readonly id: CategorizationRuleId | null;
        readonly expectedVersion: number | null;
        readonly name: string;
        readonly predicate: CategorizationRulePredicate;
        readonly categoryId: CategoryId;
        readonly effectiveFrom: CalendarDate;
        readonly retired: boolean;
        readonly requestId: RequestId;
      }): Effect.fn.Return<CategorizationRule, MoneyBoundaryError> {
        const name = yield* requireName(input.name);
        const predicate: CategorizationRulePredicate = {
          ...input.predicate,
          payeeEquals: input.predicate.payeeEquals?.trim() ?? null,
          narrativeIncludes: input.predicate.narrativeIncludes.map((term) => term.trim()),
        };
        const payloadHash = yield* payloadDigest(cryptography, {
          id: input.id,
          expectedVersion: input.expectedVersion,
          name,
          predicate: predicateEvidence(predicate),
          categoryId: input.categoryId,
          effectiveFrom: input.effectiveFrom,
          retired: input.retired,
        });

        return yield* repository
          .withTransaction(input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const previous = yield* replay({
                snapshot,
                requestId: input.requestId,
                operation: "money.edit_categorization_rule",
                payloadHash,
                schema: CategorizationRule,
              });
              if (previous !== null) return previous;
              yield* validatePredicate(snapshot, predicate);
              if (categoryById(snapshot, input.categoryId) === undefined) {
                return yield* new NotFound({ entity: "money category", id: input.categoryId });
              }

              const current = input.id === null ? undefined : ruleById(snapshot, input.id);
              if (input.id === null && input.expectedVersion !== null) {
                return yield* new ValidationFailed({
                  reason: "UnexpectedRuleVersion",
                  detail: "a new rule has no expected version",
                });
              }
              if (input.id === null && input.retired) {
                return yield* new ValidationFailed({
                  reason: "NewRuleCannotBeRetired",
                  detail: "a rule must exist before it can be retired",
                });
              }
              if (input.id !== null && current === undefined) {
                return yield* new NotFound({ entity: "categorization rule", id: input.id });
              }
              if (
                current !== undefined &&
                (input.expectedVersion === null || current.version !== input.expectedVersion)
              ) {
                return yield* new Stale({
                  reason: "CategorizationRuleVersionChanged",
                  detail: `${current.id} is now at version ${current.version}`,
                });
              }
              const id =
                current?.id ??
                (yield* mintUuidV7(cryptography, CategorizationRuleId).pipe(
                  Effect.mapError(infrastructureError),
                ));
              const retiredAt = input.retired ? yield* DateTime.now : null;
              const rule: CategorizationRule = {
                id,
                version: (current?.version ?? 0) + 1,
                name,
                predicate,
                categoryId: input.categoryId,
                effectiveFrom: input.effectiveFrom,
                retiredAt,
              };
              return yield* transaction.editRule({
                requestId: input.requestId,
                payloadHash,
                response: rule,
              });
            }),
          )
          .pipe(Effect.mapError(ledgerBoundaryError));
      });

      const resolveTransfer = Effect.fn("MoneyLedger.resolveTransfer")(function* (input: {
        readonly id: TransferMatchId;
        readonly decision: "confirmed" | "rejected";
        readonly requestId: RequestId;
      }): Effect.fn.Return<{ readonly requestId: RequestId }, MoneyBoundaryError> {
        const payloadHash = yield* payloadDigest(cryptography, {
          id: input.id,
          decision: input.decision,
        });
        return yield* repository
          .withTransaction(input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const previous = yield* replay({
                snapshot,
                requestId: input.requestId,
                operation: "money.resolve_transfer",
                payloadHash,
                schema: MutationResult,
              });
              if (previous !== null) return previous;
              const transfer = snapshot.transfers.find((candidate) => candidate.id === input.id);
              if (transfer === undefined) {
                return yield* new NotFound({ entity: "transfer review item", id: input.id });
              }
              if (
                input.decision === "confirmed" &&
                (snapshot.confirmedTransferTransactionIds.includes(transfer.debitTransactionId) ||
                  snapshot.confirmedTransferTransactionIds.includes(transfer.creditTransactionId))
              ) {
                return yield* new Conflict({
                  reason: "TransactionAlreadyMatchedAsTransfer",
                  detail: "one of the transfer transactions already belongs to a confirmed pair",
                });
              }
              return yield* transaction.resolveTransfer({
                requestId: input.requestId,
                payloadHash,
                response: { requestId: input.requestId },
                transferId: input.id,
                decision: input.decision,
              });
            }),
          )
          .pipe(Effect.mapError(ledgerBoundaryError));
      });

      const analyze = Effect.fn("MoneyLedger.analyze")(function* (
        startMonth: CalendarMonth,
        endMonth: CalendarMonth,
      ): Effect.fn.Return<MoneyAnalysis, MoneyBoundaryError> {
        if (startMonth > endMonth) {
          return yield* new ValidationFailed({
            reason: "InvalidAnalysisWindow",
            detail: "the first month must not follow the last month",
          });
        }
        const snapshot = yield* readSnapshot;
        return analyzeMoney(snapshot.analysis, startMonth, endMonth);
      });

      const generateReport = Effect.fn("MoneyLedger.generateReport")(function* (input: {
        readonly month: CalendarMonth;
        readonly requestId: RequestId;
      }): Effect.fn.Return<MonthlySpendingReport, MoneyBoundaryError> {
        const payloadHash = yield* payloadDigest(cryptography, { month: input.month });

        return yield* repository
          .withTransaction(input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const previous = yield* replay({
                snapshot,
                requestId: input.requestId,
                operation: "money.generate_monthly_report",
                payloadHash,
                schema: MonthlySpendingReport,
              });
              if (previous !== null) return previous;
              const earlier = snapshot.reports.find((report) => report.month === input.month);
              if (earlier !== undefined) return earlier;

              const window = calendarMonthWindow(input.month);
              const reportRecord = {
                ...snapshot.analysis,
                coverage: snapshot.analysis.coverage.flatMap((segment) =>
                  segment.start > window.end
                    ? []
                    : [{ ...segment, end: segment.end > window.end ? window.end : segment.end }],
                ),
                transactions: snapshot.analysis.transactions.filter(
                  (bankTransaction) => bankTransaction.postedDate <= window.end,
                ),
              };
              const analysis = analyzeMoney(reportRecord, input.month, input.month);
              const month = analysis.months[0]!;
              if (month.coverage._tag === "Incomplete") {
                return yield* new ValidationFailed({
                  reason: "IncompleteMoneyCoverage",
                  detail: month.coverage.gaps
                    .map((gap) => `${gap.accountId}:${gap.start}..${gap.end}`)
                    .join(", "),
                });
              }

              const id = yield* mintUuidV7(cryptography, ReportId).pipe(
                Effect.mapError(infrastructureError),
              );
              const generatedAt = yield* DateTime.now;
              const supportingTransactionIds = [
                ...new Set([
                  ...month.categories.flatMap((category) => category.transactionIds),
                  ...analysis.recurringCharges.flatMap((charge) => charge.transactionIds),
                  ...anomalyTransactionIds(analysis),
                  ...analysis.suggestions.flatMap((suggestion) => suggestion.transactionIds),
                ]),
              ].sort((left, right) => left.localeCompare(right));
              const report: MonthlySpendingReport = {
                id,
                month: input.month,
                generatedAt,
                readAt: null,
                dataThrough: analysis.dataThrough ?? window.end,
                analysis: month,
                recurringCharges: analysis.recurringCharges,
                anomalies: analysis.anomalies,
                suggestions: analysis.suggestions,
                supportingTransactionIds,
                bodyKey: `reports/${id}.html`,
              };
              const html = renderMonthlySpendingReport(report);
              const bytes = new TextEncoder().encode(html);
              const digest = yield* cryptography
                .sha256(bytes)
                .pipe(Effect.mapError(infrastructureError));
              yield* blobs
                .putImmutable({
                  key: report.bodyKey,
                  bytes,
                  digest,
                  mediaType: "text/html; charset=utf-8",
                })
                .pipe(Effect.mapError(infrastructureError));

              const feedEventId = yield* mintUuidV7(cryptography, FeedEventId).pipe(
                Effect.mapError(infrastructureError),
              );
              const changedCharges = analysis.recurringCharges.flatMap((charge) =>
                charge.priceChange === null ? [] : [{ charge, priceChange: charge.priceChange }],
              );
              const priceChangeEvents = yield* Effect.forEach(
                changedCharges,
                ({ charge, priceChange }) =>
                  mintUuidV7(cryptography, FeedEventId).pipe(
                    Effect.mapError(infrastructureError),
                    Effect.map((eventId) => ({
                      identity: {
                        rule: "recurring_price_change",
                        subject: charge.payee,
                        month: input.month,
                      },
                      id: eventId,
                      eventType: "recurring_price_change" as const,
                      severity: "notice" as const,
                      summary: `${charge.payee} changed from ${formatMoney(priceChange.previousAmount)} to ${formatMoney(priceChange.currentAmount)}`,
                      payload: { payee: charge.payee },
                    })),
                  ),
              );
              const anomalyEvents = yield* Effect.forEach(analysis.anomalies, (anomaly) =>
                mintUuidV7(cryptography, FeedEventId).pipe(
                  Effect.mapError(infrastructureError),
                  Effect.map((eventId) => {
                    switch (anomaly._tag) {
                      case "LargeExpense":
                        return {
                          identity: {
                            rule: "large_expense",
                            subject: anomaly.transactionId,
                            month: input.month,
                          },
                          id: eventId,
                          eventType: "spending_anomaly" as const,
                          severity: "notice" as const,
                          summary: `Large expense of ${formatMoney(anomaly.amount)}`,
                          payload: { transactionId: anomaly.transactionId },
                        };
                      case "NewPayee":
                        return {
                          identity: {
                            rule: "new_high_value_payee",
                            subject: anomaly.transactionId,
                            month: input.month,
                          },
                          id: eventId,
                          eventType: "spending_anomaly" as const,
                          severity: "notice" as const,
                          summary: `First high-value payment to ${anomaly.payee}`,
                          payload: { transactionId: anomaly.transactionId, payee: anomaly.payee },
                        };
                      case "CategorySpike":
                        return {
                          identity: {
                            rule: "category_spike",
                            subject: anomaly.categoryId,
                            month: input.month,
                          },
                          id: eventId,
                          eventType: "spending_anomaly" as const,
                          severity: "notice" as const,
                          summary: `Spending increased in category ${anomaly.categoryId}`,
                          payload: { categoryId: anomaly.categoryId },
                        };
                    }
                  }),
                ),
              );
              return yield* transaction.saveReport({
                requestId: input.requestId,
                payloadHash,
                response: report,
                feedEventId,
                analysisEvents: [...priceChangeEvents, ...anomalyEvents],
              });
            }),
          )
          .pipe(Effect.mapError(ledgerBoundaryError));
      });

      const getReport = Effect.fn("MoneyLedger.getReport")(function* (
        id: ReportId,
      ): Effect.fn.Return<
        { readonly report: MonthlySpendingReport; readonly html: string },
        MoneyBoundaryError
      > {
        const snapshot = yield* readSnapshot;
        const report = snapshot.reports.find((candidate) => candidate.id === id);
        if (report === undefined) {
          return yield* new NotFound({ entity: "monthly spending report", id });
        }
        const html = yield* blobs
          .getText(report.bodyKey)
          .pipe(Effect.mapError(infrastructureError));
        if (html === null) {
          return yield* new Internal({ detail: `report body ${report.bodyKey} is missing` });
        }
        return { report, html };
      });

      const markReportRead = Effect.fn("MoneyLedger.markReportRead")(function* (input: {
        readonly id: ReportId;
        readonly requestId: RequestId;
      }): Effect.fn.Return<MonthlySpendingReport, MoneyBoundaryError> {
        const payloadHash = yield* payloadDigest(cryptography, { id: input.id });

        return yield* repository
          .withTransaction(input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const previous = yield* replay({
                snapshot,
                requestId: input.requestId,
                operation: "money.mark_monthly_report_read",
                payloadHash,
                schema: MonthlySpendingReport,
              });
              if (previous !== null) return previous;
              const report = snapshot.reports.find((candidate) => candidate.id === input.id);
              if (report === undefined) {
                return yield* new NotFound({ entity: "monthly spending report", id: input.id });
              }
              const readAt = report.readAt ?? (yield* DateTime.now);
              const response = { ...report, readAt };
              return yield* transaction.markReportRead({
                requestId: input.requestId,
                payloadHash,
                response,
                readAt,
              });
            }),
          )
          .pipe(Effect.mapError(ledgerBoundaryError));
      });

      const transactions = Effect.fn("MoneyLedger.transactions")(function* (
        ids: readonly BankTransactionId[],
      ): Effect.fn.Return<readonly BankTransactionRecord[], MoneyBoundaryError> {
        const uniqueIds = [...new Set(ids)];
        const records = yield* repository
          .transactions(uniqueIds)
          .pipe(Effect.mapError(infrastructureError));
        const found = new Set(records.map((record) => record.id));
        const missing = uniqueIds.find((id) => !found.has(id));
        if (missing !== undefined) {
          return yield* new NotFound({ entity: "bank transaction", id: missing });
        }
        return records;
      });

      return MoneyLedger.of({
        coverage,
        listCategories: readSnapshot.pipe(Effect.map((snapshot) => snapshot.categories)),
        createCategory,
        renameCategory,
        categorizationReview: readSnapshot.pipe(Effect.map((snapshot) => snapshot.review)),
        categorize,
        rules: readSnapshot.pipe(Effect.map((snapshot) => snapshot.rules)),
        editRule,
        transferReview: readSnapshot.pipe(Effect.map((snapshot) => snapshot.transfers)),
        resolveTransfer,
        analyze,
        balances: readSnapshot.pipe(Effect.map((snapshot) => snapshot.balances)),
        transactions,
        generateReport,
        listReports: readSnapshot.pipe(Effect.map((snapshot) => snapshot.reports)),
        markReportRead,
        getReport,
      });
    }),
  );
}
