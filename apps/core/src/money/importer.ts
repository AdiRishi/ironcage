import { Conflict, Internal, NotFound, Stale, ValidationFailed } from "@ironcage/contracts/schema";
import {
  AmbiguityId,
  ArchivedBankStatement,
  BankAccount,
  BankBalanceObservationId,
  BankCoverageSegmentId,
  BankImportId,
  BankImportPreview,
  BankMonthCoverageObservationId,
  BankObservationId,
  BankSourceFileId,
  BankTransactionId,
  CalendarDate,
  ConfirmedBankImport,
  Currency,
  FeedEventId,
  formatMoney,
  Money,
  RequestId,
  Sha256,
  TransactionClassificationId,
  TransactionSplitId,
  TransferMatchId,
  uncategorizedCategoryId,
  type AmbiguityResolution,
  type BankAccountProfileId,
  type BankIdentity,
  type BankImportHistoryItem,
  type BankImportSource,
  type RegisterBankAccount,
  type UploadedBytes,
} from "@ironcage/domain";
import { BigDecimal, Context, DateTime, Effect, Layer, Option, Schema } from "effect";

import { MoneyBlobStore } from "./blob-store";
import { decodeStored, infrastructureError, type MoneyBoundaryError } from "./boundary";
import { decodeCommBankBundle, type CommBankPairedBundle } from "./commbank/bundle";
import { commBankPayee } from "./commbank/payee";
import { commBankPairedProfileId } from "./commbank/profiles";
import {
  calendarMonthForDate,
  calendarMonthsBetween,
  calendarMonthWindow,
  coverageGaps,
  intersectIntervals,
  uncoveredIntervals,
  type CoverageSegment,
} from "./coverage";
import {
  canonicalJson,
  mintUuidV7,
  MoneyCryptography,
  sha256Text,
  type CanonicalValue,
} from "./crypto";
import {
  deduplicateStructuredRows,
  type DedupeVerdict,
  type UnidentifiedDedupeVerdict,
} from "./deduplication";
import { normalizeNarrative } from "./normalization";
import {
  type BalanceObservationPlan,
  type ClassificationPlan,
  type ConfirmedImportPlan,
  type ImportSnapshot,
  MoneyAccountMissing,
  MoneyImportRepository,
  type ObservationPlan,
  type SourceFilePlan,
  type StatementArchivePlan,
  type StoredCategorizationRule,
  type TransactionPlan,
  type TransferPlan,
} from "./repository";

interface StructuredSourceIdentity {
  readonly csvDigest: Sha256;
  readonly ofxDigest: Sha256;
  readonly bundleDigest: Sha256;
}

interface PreparedImport {
  readonly preview: BankImportPreview;
  readonly bundle: CommBankPairedBundle;
  readonly verdicts: readonly DedupeVerdict[];
  readonly identity: StructuredSourceIdentity;
}

const sourceIdentity = Effect.fn("MoneyImports.sourceIdentity")(function* (
  cryptography: MoneyCryptography["Service"],
  accountId: BankAccount["id"],
  source: Extract<BankImportSource, { readonly kind: "commbank_structured" }>,
) {
  const csvDigest = yield* cryptography.sha256(source.csv.bytes);
  const ofxDigest = yield* cryptography.sha256(source.ofx.bytes);
  const roles = [`csv:${csvDigest}`, `ofx:${ofxDigest}`].sort();
  const bundleDigest = yield* sha256Text(
    cryptography,
    [commBankPairedProfileId, accountId, ...roles].join("|"),
  );

  return { csvDigest, ofxDigest, bundleDigest };
});

interface ClassifiableRow {
  readonly accountId: BankAccount["id"];
  readonly postedDate: CalendarDate;
  readonly amount: Money;
  readonly narrative: string;
  readonly payee: string;
}

/**
 * Rules are ordered by ID, which is UUIDv7 and therefore creation order: the
 * first rule the operator wrote for a payee wins over one written later.
 */
const activeRuleFor = (row: ClassifiableRow, rules: readonly StoredCategorizationRule[]) => {
  const payee = normalizeNarrative(row.payee);
  const narrative = normalizeNarrative(row.narrative);
  const absoluteAmount = BigDecimal.abs(row.amount);
  const direction = BigDecimal.sign(row.amount) < 0 ? "debit" : "credit";

  return rules.find(
    (rule) =>
      rule.effectiveFrom <= row.postedDate &&
      (rule.accountIds.length === 0 || rule.accountIds.includes(row.accountId)) &&
      (rule.direction === "either" || rule.direction === direction) &&
      (rule.payeeEquals === null || normalizeNarrative(rule.payeeEquals) === payee) &&
      rule.narrativeIncludes.every((token) => narrative.includes(normalizeNarrative(token))) &&
      (rule.minimumAbsoluteAmount === null ||
        BigDecimal.isGreaterThanOrEqualTo(absoluteAmount, rule.minimumAbsoluteAmount)) &&
      (rule.maximumAbsoluteAmount === null ||
        BigDecimal.isLessThanOrEqualTo(absoluteAmount, rule.maximumAbsoluteAmount)),
  );
};

const publicVerdict = (verdict: DedupeVerdict): BankImportPreview["verdicts"][number] => {
  const common = {
    sourceOrdinal: verdict.row.csv.sourceOrdinal,
    postedDate: verdict.row.postedDate,
    amount: verdict.row.amount,
    narrative: verdict.row.narrative,
  };

  switch (verdict._tag) {
    case "New":
      return { _tag: "New", ...common };
    case "Duplicate":
      return {
        _tag: "Duplicate",
        ...common,
        transactionId: verdict.transactionId,
        matchTier: verdict.matchTier,
      };
    case "Ambiguous":
      return {
        _tag: "Ambiguous",
        ...common,
        id: verdict.id,
        candidateTransactionIds: [...verdict.candidateTransactionIds],
      };
  }
};

const identifyAmbiguities = Effect.fn("MoneyImports.identifyAmbiguities")(function* (
  cryptography: MoneyCryptography["Service"],
  accountId: BankAccount["id"],
  bundleDigest: Sha256,
  verdicts: readonly UnidentifiedDedupeVerdict[],
) {
  return yield* Effect.forEach(verdicts, (verdict): Effect.Effect<DedupeVerdict, never> => {
    if (verdict._tag !== "Ambiguous") return Effect.succeed(verdict);

    return sha256Text(
      cryptography,
      canonicalJson({
        accountId,
        bundleDigest,
        sourceOrdinal: verdict.row.csv.sourceOrdinal,
        postedDate: verdict.row.postedDate,
        amount: formatMoney(verdict.row.amount),
        narrative: normalizeNarrative(verdict.row.narrative),
        candidates: [...verdict.candidateTransactionIds].sort(),
      }),
    ).pipe(
      Effect.map((digest) => ({
        ...verdict,
        id: Schema.decodeUnknownSync(AmbiguityId)(digest),
      })),
      Effect.orDie,
    );
  });
});

const previewFingerprintEvidence = (
  preview: Omit<BankImportPreview, "previewFingerprint">,
  rules: readonly StoredCategorizationRule[],
): CanonicalValue => ({
  accountId: preview.account.id,
  bundleDigest: preview.bundleDigest,
  window: [preview.window.start, preview.window.end],
  verdicts: preview.verdicts.map((verdict) => {
    switch (verdict._tag) {
      case "New":
        return ["new", verdict.sourceOrdinal, verdict.postedDate, formatMoney(verdict.amount)];
      case "Duplicate":
        return ["duplicate", verdict.sourceOrdinal, verdict.transactionId, verdict.matchTier];
      case "Ambiguous":
        return ["ambiguous", verdict.id, ...verdict.candidateTransactionIds];
    }
  }),
  reconciliation: [
    preview.reconciliation.balance,
    formatMoney(preview.reconciliation.ledgerBalance),
  ],
  coverage: {
    added: preview.coverage.added.map(({ start, end }) => [start, end]),
    retained: preview.coverage.retainedOverlap.map(({ start, end }) => [start, end]),
    gaps: preview.coverage.gapsRemaining.map(({ accountId, start, end }) => [
      accountId,
      start,
      end,
    ]),
  },
  rules: rules.map((rule) => [rule.id, rule.version]),
});

const prepareImport = Effect.fn("MoneyImports.prepareImport")(function* (
  source: BankImportSource,
  snapshot: ImportSnapshot,
  knownIdentity?: StructuredSourceIdentity,
): Effect.fn.Return<PreparedImport, MoneyBoundaryError, MoneyCryptography> {
  if (source.kind === "commbank_statement") {
    return yield* new ValidationFailed({
      reason: "StatementParserUnavailable",
      detail: "archive this PDF now; its account-specific transaction parser is not certified",
    });
  }

  const cryptography = yield* MoneyCryptography;
  const identity =
    knownIdentity ??
    (yield* sourceIdentity(cryptography, source.accountId, source).pipe(
      Effect.mapError(infrastructureError),
    ));

  const bundle = yield* decodeCommBankBundle({
    csv: source.csv.bytes,
    ofx: source.ofx.bytes,
    accountProfile: snapshot.selectedAccount.account.profile,
  }).pipe(
    Effect.mapError((error) => new ValidationFailed({ reason: error._tag, detail: error.detail })),
  );
  const detectedIdentityHmac = yield* cryptography
    .accountIdentityHmac(snapshot.selectedAccount.account.profile, bundle.account)
    .pipe(Effect.mapError(infrastructureError));

  if (detectedIdentityHmac !== snapshot.selectedAccount.identityHmac) {
    return yield* new ValidationFailed({
      reason: "AccountIdentityMismatch",
      detail: `the detected account does not match ${snapshot.selectedAccount.account.label}`,
    });
  }

  if (
    bundle.window.start < snapshot.selectedAccount.account.effectiveFrom ||
    (snapshot.selectedAccount.account.effectiveTo !== null &&
      bundle.window.end > snapshot.selectedAccount.account.effectiveTo)
  ) {
    return yield* new ValidationFailed({
      reason: "ImportOutsideAccountLifetime",
      detail: "the source window extends outside the account's configured lifetime",
    });
  }

  const matched = deduplicateStructuredRows(
    bundle.rows,
    snapshot.transactions.filter(
      (transaction) => transaction.accountId === snapshot.selectedAccount.account.id,
    ),
  );

  if (matched._tag === "SourceIdentifierConflict") {
    return yield* new ValidationFailed({
      reason: "SourceIdentifierConflict",
      detail: `bank identifier ${matched.conflict.identifier} disagrees with its stored date or amount`,
    });
  }

  const verdicts = yield* identifyAmbiguities(
    cryptography,
    snapshot.selectedAccount.account.id,
    identity.bundleDigest,
    matched.verdicts,
  );
  const sourceWindow = { start: bundle.window.start, end: bundle.window.end };
  const selectedCoverage = snapshot.coverage.filter(
    (segment) => segment.accountId === snapshot.selectedAccount.account.id,
  );
  const added = uncoveredIntervals(sourceWindow, selectedCoverage);
  const retainedOverlap = selectedCoverage.flatMap((segment) => {
    const overlap = intersectIntervals(sourceWindow, segment);
    return overlap === null ? [] : [overlap];
  });
  const projectedCoverage: CoverageSegment[] = [
    ...snapshot.coverage,
    { accountId: snapshot.selectedAccount.account.id, ...sourceWindow },
  ];
  const publicVerdicts = verdicts.map(publicVerdict);
  const withoutFingerprint = {
    account: snapshot.selectedAccount.account,
    detectedProfile: snapshot.selectedAccount.account.profile,
    sourceProfile: commBankPairedProfileId,
    window: sourceWindow,
    fileDigests: [
      { role: "csv" as const, digest: identity.csvDigest },
      { role: "ofx" as const, digest: identity.ofxDigest },
    ],
    bundleDigest: identity.bundleDigest,
    logicalTransactionCount: bundle.rows.length,
    observationCount: bundle.rows.length * 2,
    verdicts: publicVerdicts,
    reconciliation: {
      balance: bundle.ledger.status,
      ledgerBalance: bundle.ledger.ledgerBalance.amount,
    },
    coverage: {
      added,
      retainedOverlap,
      gapsRemaining: coverageGaps(snapshot.accounts, projectedCoverage, sourceWindow),
    },
    warnings: verdicts.flatMap((verdict) =>
      verdict._tag === "Duplicate" && verdict.narrativeChanged
        ? [
            {
              reason: "narrative_changed" as const,
              detail: `row ${verdict.row.csv.sourceOrdinal} differs from its stored narrative`,
            },
          ]
        : [],
    ),
    categoryReviewCount: verdicts.filter(
      (verdict) =>
        verdict._tag === "New" &&
        activeRuleFor(
          {
            accountId: snapshot.selectedAccount.account.id,
            postedDate: verdict.row.postedDate,
            amount: verdict.row.amount,
            narrative: verdict.row.narrative,
            payee: commBankPayee(snapshot.selectedAccount.account.profile, verdict.row.narrative),
          },
          snapshot.rules,
        ) === undefined,
    ).length,
  } satisfies Omit<BankImportPreview, "previewFingerprint">;
  const previewFingerprint = yield* sha256Text(
    cryptography,
    canonicalJson(previewFingerprintEvidence(withoutFingerprint, snapshot.rules)),
  ).pipe(Effect.mapError(infrastructureError));

  return {
    preview: { ...withoutFingerprint, previewFingerprint },
    bundle,
    verdicts,
    identity,
  };
});

const profileAccountType = (profile: BankAccountProfileId): BankAccount["type"] => {
  switch (profile) {
    case "spending-offset":
    case "savings-offset":
      return "deposit";
    case "mastercard":
      return "credit_card";
    case "home-loan":
      return "credit_line";
  }
};

const requestFor = (snapshot: ImportSnapshot, requestId: RequestId) =>
  snapshot.requests.find((request) => request.requestId === requestId);

const confirmPayloadHash = (
  cryptography: MoneyCryptography["Service"],
  prepared: StructuredSourceIdentity,
  expectedBundleDigest: Sha256,
  expectedPreviewFingerprint: Sha256,
  resolutions: readonly AmbiguityResolution[],
) =>
  sha256Text(
    cryptography,
    canonicalJson({
      sourceBundleDigest: prepared.bundleDigest,
      expectedBundleDigest,
      expectedPreviewFingerprint,
      resolutions: [...resolutions]
        .sort((left, right) => left.ambiguityId.localeCompare(right.ambiguityId))
        .map((resolution) => [
          resolution.ambiguityId,
          resolution.decision._tag,
          resolution.decision._tag === "Existing" ? resolution.decision.transactionId : null,
        ]),
    }),
  );

const dayDistance = (left: CalendarDate, right: CalendarDate) =>
  Math.abs(
    DateTime.toEpochMillis(DateTime.makeUnsafe(`${left}T00:00:00Z`)) -
      DateTime.toEpochMillis(DateTime.makeUnsafe(`${right}T00:00:00Z`)),
  ) / 86_400_000;

interface TransactionTarget {
  readonly id: BankTransactionId;
  readonly isNew: boolean;
  readonly matchTier: ObservationPlan["matchTier"];
}

interface TransferLeg {
  readonly id: BankTransactionId;
  readonly accountId: BankAccount["id"];
  readonly postedDate: CalendarDate;
  readonly amount: Money;
}

const pairKey = (debit: BankTransactionId, credit: BankTransactionId) =>
  JSON.stringify([debit, credit]);

const buildTransferPlans = Effect.fn("MoneyImports.buildTransferPlans")(function* (
  cryptography: MoneyCryptography["Service"],
  snapshot: ImportSnapshot,
  accountId: BankAccount["id"],
  newTransactions: readonly TransactionPlan[],
): Effect.fn.Return<readonly TransferPlan[], Internal> {
  const legs: TransferLeg[] = [
    ...snapshot.transactions.map((transaction) => ({
      id: transaction.transactionId,
      accountId: transaction.accountId,
      postedDate: transaction.postedDate,
      amount: transaction.amount,
    })),
    ...newTransactions.map((transaction) => ({ ...transaction, accountId })),
  ];
  const newIds = new Set(newTransactions.map((transaction) => transaction.id));
  // Every pairing the record has already reached a verdict on, so a later
  // import can never re-open one the operator answered.
  const judgedPairs = new Set(
    snapshot.transferPairs.map((pair) =>
      pairKey(pair.debitTransactionId, pair.creditTransactionId),
    ),
  );
  const confirmedIds = new Set(
    snapshot.transferPairs
      .filter((pair) => pair.status === "confirmed")
      .flatMap((pair) => [pair.debitTransactionId, pair.creditTransactionId]),
  );
  const creditsByAmount = new Map<string, TransferLeg[]>();

  for (const leg of legs) {
    if (BigDecimal.sign(leg.amount) <= 0 || confirmedIds.has(leg.id)) continue;

    const key = formatMoney(BigDecimal.abs(leg.amount));
    const group = creditsByAmount.get(key);

    if (group === undefined) creditsByAmount.set(key, [leg]);
    else group.push(leg);
  }

  const candidates: {
    readonly debitTransactionId: BankTransactionId;
    readonly creditTransactionId: BankTransactionId;
  }[] = [];

  for (const debit of legs) {
    if (BigDecimal.sign(debit.amount) >= 0 || confirmedIds.has(debit.id)) continue;

    for (const credit of creditsByAmount.get(formatMoney(BigDecimal.abs(debit.amount))) ?? []) {
      if (
        debit.accountId === credit.accountId ||
        dayDistance(debit.postedDate, credit.postedDate) > 3 ||
        (!newIds.has(debit.id) && !newIds.has(credit.id)) ||
        judgedPairs.has(pairKey(debit.id, credit.id))
      ) {
        continue;
      }

      candidates.push({ debitTransactionId: debit.id, creditTransactionId: credit.id });
    }
  }

  const degree = new Map<BankTransactionId, number>();
  for (const pair of snapshot.transferPairs.filter(
    (candidate) => candidate.status === "proposed",
  )) {
    degree.set(pair.debitTransactionId, (degree.get(pair.debitTransactionId) ?? 0) + 1);
    degree.set(pair.creditTransactionId, (degree.get(pair.creditTransactionId) ?? 0) + 1);
  }
  for (const candidate of candidates) {
    degree.set(candidate.debitTransactionId, (degree.get(candidate.debitTransactionId) ?? 0) + 1);
    degree.set(candidate.creditTransactionId, (degree.get(candidate.creditTransactionId) ?? 0) + 1);
  }

  return yield* Effect.forEach(candidates, (candidate) =>
    mintUuidV7(cryptography, TransferMatchId).pipe(
      Effect.mapError(infrastructureError),
      Effect.map((id) => {
        const unique =
          degree.get(candidate.debitTransactionId) === 1 &&
          degree.get(candidate.creditTransactionId) === 1;
        return {
          id,
          ...candidate,
          status: unique ? ("confirmed" as const) : ("proposed" as const),
          method: unique ? ("unique" as const) : ("amount_date" as const),
          provenance: { rule: "opposite_sign_exact_amount_within_three_days" },
        };
      }),
    ),
  );
});

const buildCoverageStatusPlans = Effect.fn("MoneyImports.buildCoverageStatusPlans")(function* (
  cryptography: MoneyCryptography["Service"],
  snapshot: ImportSnapshot,
  coverage: CoverageSegment,
) {
  const projectedCoverage = [...snapshot.coverage, coverage];
  const months = calendarMonthsBetween(
    calendarMonthForDate(coverage.start),
    calendarMonthForDate(coverage.end),
  );
  const statuses = months.flatMap((month) => {
    const monthWindow = calendarMonthWindow(month);

    return snapshot.accounts.flatMap((account) => {
      const requiredWindow = intersectIntervals(monthWindow, {
        start: account.effectiveFrom,
        end: account.effectiveTo ?? monthWindow.end,
      });
      return !account.required || requiredWindow === null ? [] : [{ account, month, monthWindow }];
    });
  });

  return yield* Effect.forEach(statuses, ({ account, month, monthWindow }) =>
    Effect.all({
      id: mintUuidV7(cryptography, BankMonthCoverageObservationId).pipe(
        Effect.mapError(infrastructureError),
      ),
      eventId: mintUuidV7(cryptography, FeedEventId).pipe(Effect.mapError(infrastructureError)),
    }).pipe(
      Effect.map(({ id, eventId }) => ({
        id,
        accountId: account.id,
        month,
        complete: coverageGaps([account], projectedCoverage, monthWindow).length === 0,
        eventId,
      })),
    ),
  );
});

const buildConfirmationPlan = Effect.fn("MoneyImports.buildConfirmationPlan")(function* (
  cryptography: MoneyCryptography["Service"],
  snapshot: ImportSnapshot,
  prepared: PreparedImport,
  source: Extract<BankImportSource, { readonly kind: "commbank_structured" }>,
  requestId: RequestId,
  requestPayloadHash: Sha256,
  resolutions: readonly AmbiguityResolution[],
): Effect.fn.Return<ConfirmedImportPlan, MoneyBoundaryError> {
  const ambiguities = prepared.verdicts.filter(
    (verdict): verdict is Extract<DedupeVerdict, { readonly _tag: "Ambiguous" }> =>
      verdict._tag === "Ambiguous",
  );
  const resolutionById = new Map(
    resolutions.map((resolution) => [resolution.ambiguityId, resolution]),
  );

  if (resolutionById.size !== resolutions.length) {
    return yield* new ValidationFailed({
      reason: "DuplicateAmbiguityResolution",
      detail: "each ambiguity may be resolved once",
    });
  }

  if (
    ambiguities.some((ambiguity) => !resolutionById.has(ambiguity.id)) ||
    resolutions.some(
      (resolution) => !ambiguities.some((ambiguity) => ambiguity.id === resolution.ambiguityId),
    )
  ) {
    return yield* new ValidationFailed({
      reason: "AmbiguityResolutionSetMismatch",
      detail: "the resolutions must exactly cover the current ambiguous rows",
    });
  }

  const targets = new Map<number, TransactionTarget>();
  const transactions: TransactionPlan[] = [];
  // One canonical transaction cannot satisfy two incoming rows. The matching
  // pass enforces that within a tier, but an ambiguity's candidate list is not
  // filtered by what a later tier claimed, so the two paths have to agree here.
  const claimedExistingTransactions = new Set<BankTransactionId>();
  const claimExisting = (transactionId: BankTransactionId, matchTier: TransactionTarget["matchTier"], sourceOrdinal: number) => {
    if (claimedExistingTransactions.has(transactionId)) {
      return new ValidationFailed({
        reason: "TransactionClaimedTwice",
        detail: `${transactionId} can satisfy only one source row`,
      });
    }

    claimedExistingTransactions.add(transactionId);
    targets.set(sourceOrdinal, { id: transactionId, isNew: false, matchTier });
    return null;
  };

  for (const verdict of prepared.verdicts) {
    if (verdict._tag === "Duplicate") {
      const rejected = claimExisting(
        verdict.transactionId,
        verdict.matchTier,
        verdict.row.csv.sourceOrdinal,
      );

      if (rejected !== null) return yield* rejected;
      continue;
    }

    if (verdict._tag === "Ambiguous") {
      const resolution = resolutionById.get(verdict.id)!;
      if (resolution.decision._tag === "Existing") {
        if (!verdict.candidateTransactionIds.includes(resolution.decision.transactionId)) {
          return yield* new ValidationFailed({
            reason: "InvalidAmbiguityCandidate",
            detail: `${resolution.decision.transactionId} is not a candidate for ${verdict.id}`,
          });
        }

        const rejected = claimExisting(
          resolution.decision.transactionId,
          "manual",
          verdict.row.csv.sourceOrdinal,
        );

        if (rejected !== null) return yield* rejected;
        continue;
      }
    }

    const id = yield* mintUuidV7(cryptography, BankTransactionId).pipe(
      Effect.mapError(infrastructureError),
    );
    const row = verdict.row;
    targets.set(row.csv.sourceOrdinal, {
      id,
      isNew: true,
      matchTier: verdict._tag === "Ambiguous" ? "manual" : "new",
    });
    transactions.push({
      id,
      postedDate: row.postedDate,
      amount: row.amount,
      preferredNarrative: row.narrative,
      payee: commBankPayee(snapshot.selectedAccount.account.profile, row.narrative),
    });
  }

  const importId = yield* mintUuidV7(cryptography, BankImportId).pipe(
    Effect.mapError(infrastructureError),
  );
  const csvFileId = yield* mintUuidV7(cryptography, BankSourceFileId).pipe(
    Effect.mapError(infrastructureError),
  );
  const ofxFileId = yield* mintUuidV7(cryptography, BankSourceFileId).pipe(
    Effect.mapError(infrastructureError),
  );
  const sourceFiles: SourceFilePlan[] = [
    {
      id: csvFileId,
      role: "csv",
      mediaType: source.csv.mediaType,
      byteDigest: prepared.identity.csvDigest,
      r2Key: `exports/commbank/${prepared.identity.bundleDigest}/source.csv`,
      originalName: source.csv.name,
      byteLength: source.csv.bytes.byteLength,
    },
    {
      id: ofxFileId,
      role: "ofx",
      mediaType: source.ofx.mediaType,
      byteDigest: prepared.identity.ofxDigest,
      r2Key: `exports/commbank/${prepared.identity.bundleDigest}/source.ofx`,
      originalName: source.ofx.name,
      byteLength: source.ofx.bytes.byteLength,
    },
  ];
  const observations: ObservationPlan[] = [];
  const csvObservationByOrdinal = new Map<number, BankObservationId>();

  for (const row of prepared.bundle.rows) {
    const target = targets.get(row.csv.sourceOrdinal)!;
    const csvObservationId = yield* mintUuidV7(cryptography, BankObservationId).pipe(
      Effect.mapError(infrastructureError),
    );
    const ofxObservationId = yield* mintUuidV7(cryptography, BankObservationId).pipe(
      Effect.mapError(infrastructureError),
    );
    csvObservationByOrdinal.set(row.csv.sourceOrdinal, csvObservationId);
    const provenance = {
      bundleDigest: prepared.identity.bundleDigest,
      decision: target.matchTier,
    };
    observations.push(
      {
        id: csvObservationId,
        sourceFileId: csvFileId,
        sourceOrdinal: row.csv.sourceOrdinal,
        sourceKind: "csv",
        rawFields: row.csv.raw,
        parsedFields: {
          postedDate: row.postedDate,
          amount: formatMoney(row.amount),
          narrative: normalizeNarrative(row.narrative),
          rowBalance: Option.match(row.csv.rowBalance, {
            onNone: () => "",
            onSome: formatMoney,
          }),
        },
        postedDate: row.postedDate,
        amount: row.amount,
        rowBalance: Option.getOrNull(row.csv.rowBalance),
        bankIdentifier: null,
        narrativeFingerprint: normalizeNarrative(row.narrative),
        equalRowOccurrence: row.occurrence,
        transactionId: target.id,
        matchTier: target.matchTier,
        provenance,
      },
      {
        id: ofxObservationId,
        sourceFileId: ofxFileId,
        sourceOrdinal: row.ofx.sourceOrdinal,
        sourceKind: "ofx",
        rawFields: row.ofx.raw,
        parsedFields: {
          postedDate: row.postedDate,
          userDate: row.ofx.userDate,
          amount: formatMoney(row.amount),
          narrative: normalizeNarrative(row.narrative),
          transactionType: row.ofx.type,
        },
        postedDate: row.postedDate,
        amount: row.amount,
        rowBalance: null,
        bankIdentifier: Option.getOrNull(row.ofx.identifier),
        narrativeFingerprint: normalizeNarrative(row.narrative),
        equalRowOccurrence: row.occurrence,
        transactionId: target.id,
        matchTier: target.matchTier,
        provenance,
      },
    );
  }

  const balances: BalanceObservationPlan[] = [];
  for (const row of prepared.bundle.rows) {
    if (Option.isNone(row.csv.rowBalance)) continue;
    balances.push({
      id: yield* mintUuidV7(cryptography, BankBalanceObservationId).pipe(
        Effect.mapError(infrastructureError),
      ),
      kind: "row",
      value: row.csv.rowBalance.value,
      asOfDate: row.postedDate,
      sourceObservationId: csvObservationByOrdinal.get(row.csv.sourceOrdinal)!,
      sourceFileId: null,
    });
  }
  balances.push({
    id: yield* mintUuidV7(cryptography, BankBalanceObservationId).pipe(
      Effect.mapError(infrastructureError),
    ),
    kind: "ledger",
    value: prepared.bundle.ledger.ledgerBalance.amount,
    asOfDate: prepared.bundle.ledger.ledgerBalance.asOfDate,
    sourceObservationId: null,
    sourceFileId: ofxFileId,
  });
  if (Option.isSome(prepared.bundle.availableBalance)) {
    balances.push({
      id: yield* mintUuidV7(cryptography, BankBalanceObservationId).pipe(
        Effect.mapError(infrastructureError),
      ),
      kind: "available",
      value: prepared.bundle.availableBalance.value.amount,
      asOfDate: prepared.bundle.availableBalance.value.asOfDate,
      sourceObservationId: null,
      sourceFileId: ofxFileId,
    });
  }

  const classifications: ClassificationPlan[] = [];
  for (const transaction of transactions) {
    const rule = activeRuleFor(
      {
        accountId: snapshot.selectedAccount.account.id,
        postedDate: transaction.postedDate,
        amount: transaction.amount,
        narrative: transaction.preferredNarrative,
        payee: transaction.payee,
      },
      snapshot.rules,
    );
    classifications.push({
      id: yield* mintUuidV7(cryptography, TransactionClassificationId).pipe(
        Effect.mapError(infrastructureError),
      ),
      transactionId: transaction.id,
      provenance: rule === undefined ? "system" : "rule",
      sourceId: rule?.id ?? null,
      sourceVersion: rule?.version ?? null,
      amount: transaction.amount,
      split: {
        id: yield* mintUuidV7(cryptography, TransactionSplitId).pipe(
          Effect.mapError(infrastructureError),
        ),
        categoryId: rule?.categoryId ?? uncategorizedCategoryId,
        amount: transaction.amount,
      },
    });
  }

  const transfers = yield* buildTransferPlans(
    cryptography,
    snapshot,
    snapshot.selectedAccount.account.id,
    transactions,
  );
  const now = yield* DateTime.now;
  const coverageId = yield* mintUuidV7(cryptography, BankCoverageSegmentId).pipe(
    Effect.mapError(infrastructureError),
  );
  const coverage = {
    id: coverageId,
    accountId: snapshot.selectedAccount.account.id,
    ...prepared.preview.window,
  };
  const coverageStatuses = yield* buildCoverageStatusPlans(cryptography, snapshot, coverage);
  const feedEventId = yield* mintUuidV7(cryptography, FeedEventId).pipe(
    Effect.mapError(infrastructureError),
  );
  const existingTargets = [...targets.values()].filter((target) => !target.isNew).length;
  const result: ConfirmedBankImport = {
    importId,
    accountId: snapshot.selectedAccount.account.id,
    bundleDigest: prepared.identity.bundleDigest,
    sourceWindow: prepared.preview.window,
    sourceTransactions: prepared.bundle.rows.length,
    observations: observations.length,
    newTransactions: transactions.length,
    duplicates: existingTargets,
    resolvedAmbiguities: resolutions.length,
    coverage: prepared.preview.coverage,
    feedEventId,
    confirmedAt: now,
  };

  return {
    result,
    preview: prepared.preview,
    requestId,
    requestPayloadHash,
    previewFingerprint: prepared.preview.previewFingerprint,
    sourceProfile: commBankPairedProfileId,
    sourceFiles,
    transactions,
    observations,
    balances,
    coverage: { id: coverageId, ...prepared.preview.window },
    classifications,
    transfers,
    coverageStatuses,
    feedEvent: {
      id: feedEventId,
      payload: {
        sourceTransactions: result.sourceTransactions,
        observations: result.observations,
        newTransactions: result.newTransactions,
        duplicates: result.duplicates,
        ambiguities: result.resolvedAmbiguities,
        coverageDaysAdded: prepared.preview.coverage.added.length,
      },
    },
  };
});

const validateStatement = (pdf: UploadedBytes): Effect.Effect<void, ValidationFailed> => {
  const header = new TextDecoder().decode(pdf.bytes.subarray(0, 5));

  if (pdf.mediaType !== "application/pdf" || header !== "%PDF-") {
    return Effect.fail(
      new ValidationFailed({
        reason: "InvalidStatementPdf",
        detail: "statement archives must contain PDF bytes and use application/pdf",
      }),
    );
  }

  return Effect.void;
};

export class MoneyImports extends Context.Service<
  MoneyImports,
  {
    readonly registerAccount: (input: {
      readonly account: RegisterBankAccount;
      readonly requestId: RequestId;
    }) => Effect.Effect<BankAccount, MoneyBoundaryError>;
    readonly listAccounts: Effect.Effect<readonly BankAccount[], MoneyBoundaryError>;
    readonly preview: (
      source: BankImportSource,
    ) => Effect.Effect<BankImportPreview, MoneyBoundaryError>;
    readonly confirm: (input: {
      readonly source: BankImportSource;
      readonly expectedBundleDigest: Sha256;
      readonly expectedPreviewFingerprint: Sha256;
      readonly resolutions: readonly AmbiguityResolution[];
      readonly requestId: RequestId;
    }) => Effect.Effect<ConfirmedBankImport, MoneyBoundaryError>;
    readonly archiveStatement: (input: {
      readonly accountId: BankAccount["id"];
      readonly pdf: UploadedBytes;
      readonly requestId: RequestId;
    }) => Effect.Effect<ArchivedBankStatement, MoneyBoundaryError>;
    readonly history: (
      accountId: BankAccount["id"] | null,
    ) => Effect.Effect<readonly BankImportHistoryItem[], MoneyBoundaryError>;
  }
>()("ironcage/core/money/MoneyImports") {
  static readonly layer = Layer.effect(
    MoneyImports,
    Effect.gen(function* () {
      const repository = yield* MoneyImportRepository;
      const cryptography = yield* MoneyCryptography;
      const blobs = yield* MoneyBlobStore;

      const registerAccount = Effect.fn("MoneyImports.registerAccount")(function* (input: {
        readonly account: RegisterBankAccount;
        readonly requestId: RequestId;
      }): Effect.fn.Return<BankAccount, MoneyBoundaryError> {
        const label = input.account.label.trim();
        const identity: BankIdentity =
          input.account.identity.messageSet === "bank"
            ? {
                messageSet: "bank",
                bankId: input.account.identity.bankId.trim(),
                accountId: input.account.identity.accountId.trim(),
                accountType: input.account.identity.accountType.trim(),
              }
            : {
                messageSet: "credit_card",
                accountId: input.account.identity.accountId.trim(),
              };
        if (
          label.length === 0 ||
          identity.accountId.length === 0 ||
          (identity.messageSet === "bank" &&
            (identity.bankId.length === 0 || identity.accountType.length === 0))
        ) {
          return yield* new ValidationFailed({
            reason: "EmptyAccountIdentity",
            detail: "account labels and bank identity fields must contain text",
          });
        }
        if (input.account.maskedSuffix !== identity.accountId.slice(-4)) {
          return yield* new ValidationFailed({
            reason: "MaskedSuffixMismatch",
            detail: "the masked suffix must match the bank-supplied account identifier",
          });
        }

        const expectedType = profileAccountType(input.account.profile);
        const identityType =
          identity.messageSet === "credit_card"
            ? "credit_card"
            : identity.accountType === "CREDITLINE"
              ? "credit_line"
              : "deposit";

        if (expectedType !== identityType) {
          return yield* new ValidationFailed({
            reason: "AccountProfileMismatch",
            detail: `${input.account.profile} does not accept the supplied bank account type`,
          });
        }

        const identityHmac = yield* cryptography
          .accountIdentityHmac(input.account.profile, identity)
          .pipe(Effect.mapError(infrastructureError));
        const requestPayloadHash = yield* sha256Text(
          cryptography,
          canonicalJson({
            id: input.account.id,
            profile: input.account.profile,
            label,
            maskedSuffix: input.account.maskedSuffix,
            identityHmac,
            required: input.account.required,
            effectiveFrom: input.account.effectiveFrom,
          }),
        ).pipe(Effect.mapError(infrastructureError));
        const currency = Schema.decodeUnknownSync(Currency)("AUD");
        const account = Schema.decodeUnknownSync(BankAccount)({
          id: input.account.id,
          profile: input.account.profile,
          label,
          type: expectedType,
          maskedSuffix: input.account.maskedSuffix,
          currency,
          required: input.account.required,
          effectiveFrom: input.account.effectiveFrom,
          effectiveTo: null,
        });
        const outcome = yield* repository
          .registerAccount({
            account: { account, identityHmac },
            requestId: input.requestId,
            requestPayloadHash,
          })
          .pipe(Effect.mapError(infrastructureError));

        switch (outcome._tag) {
          case "Applied":
            return outcome.account;
          case "Replay":
            return yield* decodeStored(BankAccount, outcome.response, "account registration");
          case "RequestConflict":
            return yield* new Conflict({
              reason: "RequestIdCollision",
              detail: `${input.requestId} was already used with different content`,
            });
          case "IdentityConflict":
            return yield* new Conflict({
              reason: "AccountIdentityAlreadyRegistered",
              detail: `the bank identity belongs to ${outcome.existingAccountId}`,
            });
          case "AccountConflict":
            return yield* new Conflict({
              reason: "BankAccountAlreadyRegistered",
              detail: `${outcome.field} belongs to ${outcome.existingAccountId}`,
            });
        }
      });

      const listAccounts = repository.listAccounts.pipe(Effect.mapError(infrastructureError));

      const preview = Effect.fn("MoneyImports.preview")(function* (
        source: BankImportSource,
      ): Effect.fn.Return<BankImportPreview, MoneyBoundaryError> {
        const snapshot = yield* repository
          .snapshot(source.accountId)
          .pipe(
            Effect.mapError((error) =>
              error instanceof MoneyAccountMissing
                ? new NotFound({ entity: "bank account", id: error.accountId })
                : infrastructureError(error),
            ),
          );
        if (source.kind === "commbank_structured") {
          const identity = yield* sourceIdentity(cryptography, source.accountId, source).pipe(
            Effect.mapError(infrastructureError),
          );
          const earlier = snapshot.imports.find(
            (candidate) => candidate.bundleDigest === identity.bundleDigest,
          );
          if (earlier !== undefined) {
            return yield* decodeStored(BankImportPreview, earlier.preview, "bank import preview");
          }

          const prepared = yield* prepareImport(source, snapshot, identity).pipe(
            Effect.provideService(MoneyCryptography, cryptography),
          );
          return prepared.preview;
        }

        const prepared = yield* prepareImport(source, snapshot).pipe(
          Effect.provideService(MoneyCryptography, cryptography),
        );
        return prepared.preview;
      });

      const confirm = Effect.fn("MoneyImports.confirm")(function* (input: {
        readonly source: BankImportSource;
        readonly expectedBundleDigest: Sha256;
        readonly expectedPreviewFingerprint: Sha256;
        readonly resolutions: readonly AmbiguityResolution[];
        readonly requestId: RequestId;
      }): Effect.fn.Return<ConfirmedBankImport, MoneyBoundaryError> {
        const source = input.source;
        if (source.kind === "commbank_statement") {
          return yield* new ValidationFailed({
            reason: "StatementParserUnavailable",
            detail: "archive this PDF instead of confirming it as transaction evidence",
          });
        }

        return yield* repository
          .withAccountTransaction(source.accountId, input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const identity = yield* sourceIdentity(cryptography, source.accountId, source).pipe(
                Effect.mapError(infrastructureError),
              );
              const payloadHash = yield* confirmPayloadHash(
                cryptography,
                identity,
                input.expectedBundleDigest,
                input.expectedPreviewFingerprint,
                input.resolutions,
              ).pipe(Effect.mapError(infrastructureError));
              const previousRequest = requestFor(snapshot, input.requestId);

              if (previousRequest !== undefined) {
                if (
                  previousRequest.operation !== "money.confirm_import" ||
                  previousRequest.payloadHash !== payloadHash
                ) {
                  return yield* new Conflict({
                    reason: "RequestIdCollision",
                    detail: `${input.requestId} was already used with different content`,
                  });
                }
                return yield* decodeStored(
                  ConfirmedBankImport,
                  previousRequest.response,
                  "confirmed import",
                );
              }

              if (identity.bundleDigest !== input.expectedBundleDigest) {
                return yield* new Conflict({
                  reason: "ImportBytesChanged",
                  detail: "the confirmed files differ from the previewed files",
                });
              }

              const earlier = snapshot.imports.find(
                (candidate) => candidate.bundleDigest === identity.bundleDigest,
              );
              if (earlier !== undefined) {
                return yield* decodeStored(ConfirmedBankImport, earlier.result, "confirmed import");
              }

              const prepared = yield* prepareImport(source, snapshot, identity).pipe(
                Effect.provideService(MoneyCryptography, cryptography),
              );

              if (prepared.preview.previewFingerprint !== input.expectedPreviewFingerprint) {
                return yield* new Stale({
                  reason: "PreviewStale",
                  detail: "the transaction record or categorization rules changed after preview",
                });
              }

              const plan = yield* buildConfirmationPlan(
                cryptography,
                snapshot,
                prepared,
                source,
                input.requestId,
                payloadHash,
                input.resolutions,
              );
              yield* Effect.forEach(
                [
                  { file: source.csv, plan: plan.sourceFiles[0]! },
                  { file: source.ofx, plan: plan.sourceFiles[1]! },
                ],
                ({ file, plan: sourceFile }) =>
                  blobs.putImmutable({
                    key: sourceFile.r2Key,
                    bytes: file.bytes,
                    digest: sourceFile.byteDigest,
                    mediaType: file.mediaType,
                  }),
                { concurrency: 2, discard: true },
              ).pipe(Effect.mapError(infrastructureError));

              return yield* transaction
                .commitImport(plan)
                .pipe(Effect.mapError(infrastructureError));
            }),
          )
          .pipe(
            Effect.mapError((error) =>
              error instanceof MoneyAccountMissing
                ? new NotFound({ entity: "bank account", id: error.accountId })
                : error instanceof ValidationFailed ||
                    error instanceof Conflict ||
                    error instanceof Stale ||
                    error instanceof Internal
                  ? error
                  : infrastructureError(error),
            ),
          );
      });

      const archiveStatement = Effect.fn("MoneyImports.archiveStatement")(function* (input: {
        readonly accountId: BankAccount["id"];
        readonly pdf: UploadedBytes;
        readonly requestId: RequestId;
      }): Effect.fn.Return<ArchivedBankStatement, MoneyBoundaryError> {
        yield* validateStatement(input.pdf);

        return yield* repository
          .withAccountTransaction(input.accountId, input.requestId, (transaction) =>
            Effect.gen(function* () {
              const snapshot = yield* transaction.snapshot;
              const digest = yield* cryptography
                .sha256(input.pdf.bytes)
                .pipe(Effect.mapError(infrastructureError));
              const payloadHash = yield* sha256Text(
                cryptography,
                canonicalJson({
                  accountId: input.accountId,
                  digest,
                  name: input.pdf.name,
                  mediaType: input.pdf.mediaType,
                }),
              ).pipe(Effect.mapError(infrastructureError));
              const previousRequest = requestFor(snapshot, input.requestId);

              if (previousRequest !== undefined) {
                if (
                  previousRequest.operation !== "money.archive_statement" ||
                  previousRequest.payloadHash !== payloadHash
                ) {
                  return yield* new Conflict({
                    reason: "RequestIdCollision",
                    detail: `${input.requestId} was already used with different content`,
                  });
                }
                return yield* decodeStored(
                  ArchivedBankStatement,
                  previousRequest.response,
                  "statement archive",
                );
              }

              const earlier = snapshot.statementArchives.find(
                (archive) => archive.digest === digest,
              );
              if (earlier !== undefined) {
                return yield* decodeStored(
                  ArchivedBankStatement,
                  earlier.result,
                  "statement archive",
                );
              }

              const id = yield* mintUuidV7(cryptography, BankImportId).pipe(
                Effect.mapError(infrastructureError),
              );
              const archivedAt = yield* DateTime.now;
              const result: ArchivedBankStatement = {
                id,
                accountId: input.accountId,
                digest,
                r2Key: `exports/commbank/statements/${digest}.pdf`,
                archivedAt,
              };
              const plan: StatementArchivePlan = {
                result,
                requestId: input.requestId,
                requestPayloadHash: payloadHash,
                originalName: input.pdf.name,
                mediaType: input.pdf.mediaType,
                byteLength: input.pdf.bytes.byteLength,
              };
              yield* blobs
                .putImmutable({
                  key: result.r2Key,
                  bytes: input.pdf.bytes,
                  digest,
                  mediaType: input.pdf.mediaType,
                })
                .pipe(Effect.mapError(infrastructureError));
              return yield* transaction
                .commitStatementArchive(plan)
                .pipe(Effect.mapError(infrastructureError));
            }),
          )
          .pipe(
            Effect.mapError((error) =>
              error instanceof MoneyAccountMissing
                ? new NotFound({ entity: "bank account", id: error.accountId })
                : error instanceof Conflict || error instanceof Internal
                  ? error
                  : infrastructureError(error),
            ),
          );
      });

      const history = (accountId: BankAccount["id"] | null) =>
        repository.importHistory(accountId).pipe(Effect.mapError(infrastructureError));

      return MoneyImports.of({
        registerAccount,
        listAccounts,
        preview,
        confirm,
        archiveStatement,
        history,
      });
    }),
  );
}
