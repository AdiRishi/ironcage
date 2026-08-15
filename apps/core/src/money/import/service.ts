import {
  Conflict,
  ConfirmBankImportResult,
  Internal,
  NotFound,
  Stale,
  ValidationFailed,
  type AmbiguityResolution,
  type BankImportPreview,
  type BankImportSource,
  type CandidateEffect,
  type PreviewBankImportResult,
} from "@ironcage/contracts/schema";
import {
  AmbiguityResolutionId,
  Aud,
  BalanceObservationId,
  BankImportId,
  BankObservationId,
  BankSourceFileId,
  BankTransactionId,
  CoverageSegmentId,
  FeedEventId,
  monthOf,
  Sha256,
  type SourceProfile,
  TransactionSplitId,
  uncategorizedCategoryId,
  type BankAccountId,
  type CalendarDate,
  type RequestId,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { PersistenceError, persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";
import { generateMonthlySpendingReports } from "../../reports/service";
import {
  bindAccountIdentity,
  findAccountByIdentity,
  getAccount,
  type AccountRow,
} from "../accounts/repository";
import type { ArtifactStore } from "../artifacts";
import { enqueueCategorizationBatches } from "../categorization/dispatch";
import { loadEffectiveRules } from "../categorization/repository";
import { firstMatchingRule, type EffectiveRule } from "../categorization/rules";
import { emitCoverageEvents, emitDerivedEvents } from "../feed/service";
import { detectOwnedTransfers } from "../transfers/service";
import { BankImportBlocked, blocked } from "./block";
import { bundleDigest, validatePairedBundle, type PairedBundle } from "./bundle";
import { sha256Hex } from "./bytes";
import { coverageGaps, mergeSpans, type CoveredSpan } from "./coverage";
import { parseBankCsv } from "./csv";
import { matchCandidates, type MatchOutcome } from "./matching";
import {
  derivePayee,
  displayNarrative,
  narrativeFingerprint,
  normalizerVersion,
} from "./normalize";
import { parseBankOfx } from "./ofx";
import { accountIdentityInput, hmacSha256Hex, pairedProfileName, pairedRules } from "./profiles";
import {
  findImportByDigest,
  insertConfirmedImport,
  loadCoverageSpans,
  loadEvidence,
  type ConfirmedImportGraph,
  type ImportRow,
} from "./repository";

/** The v1 import parser version stored on every observation. */
const parserVersion = 1;

export interface ImportDeps {
  /** Keys the account-identity HMAC; provisioned per environment. */
  readonly identityKey: string;
  /** Content-addressed source artifacts; writes happen before the DB commit. */
  readonly artifacts: ArtifactStore;
}

const decodeAud = Schema.decodeUnknownSync(Aud);
const decodeSha = Schema.decodeUnknownSync(Sha256);

const aud = (value: BigDecimal.BigDecimal) =>
  decodeAud(BigDecimal.format(BigDecimal.normalize(value)));

interface DigestedFile {
  readonly role: "csv" | "ofx";
  readonly bytes: Uint8Array;
  readonly displayName: string;
  readonly digest: Sha256;
  readonly mediaType: string;
  readonly extractor: null;
}

interface ComputationBase {
  readonly account: AccountRow;
  readonly digest: Sha256;
  readonly profile: SourceProfile;
  readonly files: readonly DigestedFile[];
}

interface ReplayComputation extends ComputationBase {
  readonly kind: "replay";
  readonly import: ImportRow;
}

interface NewImportComputation extends ComputationBase {
  readonly kind: "new";
  readonly bundle: PairedBundle;
  readonly outcomes: readonly MatchOutcome[];
  readonly window: CoveredSpan;
  readonly identityHmac: string;
  readonly maskedSuffix: string;
  readonly candidates: readonly CandidateEffect[];
  readonly ruleHits: ReadonlyMap<number, EffectiveRule>;
  readonly coverage: {
    readonly segment: CoveredSpan;
    readonly added: readonly CoveredSpan[];
    readonly overlapRetained: readonly CoveredSpan[];
    readonly gapsBefore: readonly CoveredSpan[];
    readonly gapsRemaining: readonly CoveredSpan[];
  };
  readonly balances: {
    readonly ledger: BigDecimal.BigDecimal | null;
    readonly available: BigDecimal.BigDecimal | null;
    readonly ledgerReconciled: boolean;
  };
  readonly warnings: readonly string[];
  readonly fingerprint: Sha256;
}

type Computation = ReplayComputation | NewImportComputation;

const intersect = (a: CoveredSpan, b: CoveredSpan): CoveredSpan | null => {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
};

const digestFile = (
  role: DigestedFile["role"],
  bytes: Uint8Array,
  displayName: string,
  mediaType: string,
) =>
  Effect.map(
    Effect.promise(() => sha256Hex(bytes)),
    (digest): DigestedFile => ({
      role,
      bytes,
      displayName,
      digest: decodeSha(digest),
      mediaType,
      extractor: null,
    }),
  );

/** Refuses files whose bank identity contradicts the selected account. */
const verifyIdentity = Effect.fn("verifyAccountIdentity")(function* (
  sql: SqlExecutor,
  account: AccountRow,
  identityHmac: string,
): Effect.fn.Return<void, BankImportBlocked | PersistenceError> {
  if (account.identityHmac !== null && account.identityHmac !== identityHmac) {
    return yield* blocked(
      "AccountMismatch",
      `the file's identity does not match ${account.productLabel}`,
    );
  }
  const identityOwner = yield* findAccountByIdentity(sql, account.bank, identityHmac);
  if (identityOwner !== null && identityOwner.id !== account.id) {
    return yield* blocked(
      "AccountMismatch",
      `the file's identity belongs to ${identityOwner.productLabel}`,
    );
  }
});

const accountLife = (account: AccountRow): CoveredSpan => ({
  start: account.openedOn ?? ("0001-01-01" as CalendarDate),
  end: account.closedOn ?? ("9999-12-31" as CalendarDate),
});

const computeCoverageEffects = Effect.fn("computeCoverageEffects")(function* (
  sql: SqlExecutor,
  accountId: BankAccountId,
  segment: CoveredSpan,
) {
  const existing = mergeSpans(yield* loadCoverageSpans(sql, accountId));
  const added = coverageGaps(existing, segment);
  const overlapRetained = existing.flatMap((span) => {
    const shared = intersect(span, segment);
    return shared === null ? [] : [shared];
  });
  const gapsBefore =
    existing.length === 0
      ? []
      : coverageGaps(existing, {
          start: existing[0]!.start,
          end: existing[existing.length - 1]!.end,
        });
  const union = mergeSpans([...existing, segment]);
  const gapsRemaining =
    union.length === 0
      ? []
      : coverageGaps(union, { start: union[0]!.start, end: union[union.length - 1]!.end });

  return { segment, added, overlapRetained, gapsBefore, gapsRemaining, existing };
});

const fingerprintOf = (
  digest: Sha256,
  candidates: readonly CandidateEffect[],
  segment: CoveredSpan,
) =>
  Effect.map(
    Effect.promise(() =>
      sha256Hex(
        new TextEncoder().encode(
          JSON.stringify({
            digest,
            results: candidates.map((candidate) => ({
              ordinal: candidate.ordinal,
              status: candidate.status,
              transactionId: candidate.transactionId,
              options: candidate.options,
              category: candidate.category,
            })),
            segment,
          }),
        ),
      ),
    ),
    decodeSha,
  );

const replayComputation = (
  account: AccountRow,
  digest: Sha256,
  profile: SourceProfile,
  files: readonly DigestedFile[],
  replay: ImportRow,
): ReplayComputation => ({
  kind: "replay",
  account,
  digest,
  profile,
  files,
  import: replay,
});

/**
 * The structured CSV/OFX computation, run identically by preview (against a
 * read-only snapshot) and by confirm (under the account's advisory lock).
 * Everything runs in memory; the only writes belong to confirm's caller.
 */
const computeStructured = Effect.fn("computeStructuredImport")(function* (
  sql: SqlExecutor,
  source: BankImportSource,
  deps: ImportDeps,
  account: AccountRow,
): Effect.fn.Return<Computation, BankImportBlocked | PersistenceError> {
  const files = [
    yield* digestFile("csv", source.csv.bytes, source.csv.displayName, "text/csv"),
    yield* digestFile("ofx", source.ofx.bytes, source.ofx.displayName, "application/x-ofx"),
  ];
  const digest = decodeSha(
    yield* Effect.promise(() =>
      bundleDigest(
        pairedProfileName,
        account.id,
        files.map((file) => ({ role: file.role, digest: file.digest })),
      ),
    ),
  );

  // Tier 0: an identical confirmed bundle returns its earlier result and
  // nothing — no parser, category rule, or coverage mutation — runs again.
  const replay = yield* findImportByDigest(sql, account.id, digest);
  if (replay !== null) {
    return replayComputation(account, digest, pairedProfileName, files, replay);
  }

  const rules = pairedRules[account.accountType];
  const csvRows = yield* parseBankCsv(source.csv.bytes, rules.csvBalances);
  const ofx = yield* parseBankOfx(source.ofx.bytes, rules.ofxVariant);
  const bundle = yield* validatePairedBundle(account.accountType, csvRows, ofx);

  const identityHmac = yield* Effect.promise(() =>
    hmacSha256Hex(deps.identityKey, accountIdentityInput(account.accountType, ofx.account)),
  );
  yield* verifyIdentity(sql, account, identityHmac);

  const segment = intersect(bundle.window, accountLife(account));
  if (segment === null) {
    return yield* blocked(
      "WindowOutsideAccountLifetime",
      `${bundle.window.start}..${bundle.window.end} is outside the account's life`,
    );
  }

  const dates = [...new Set(bundle.candidates.map((candidate) => candidate.csv.postedDate))];
  const fitids =
    rules.fitids === "verified" ? bundle.candidates.map((candidate) => candidate.ofx.fitid) : [];
  const evidence = yield* loadEvidence(sql, account.id, pairedProfileName, dates, fitids);
  const outcomes = yield* matchCandidates(bundle.candidates, rules, evidence);

  const effectiveRules = yield* loadEffectiveRules(sql);
  const ruleHits = new Map<number, EffectiveRule>();
  const warnings: string[] = [];
  const candidates: CandidateEffect[] = [];

  for (const [ordinal, outcome] of outcomes.entries()) {
    const { candidate, result } = outcome;
    const payee = derivePayee(candidate.csv.raw.narrative, rules.payeeGrammar);
    const narrativeVariant = result.kind === "duplicate" && result.narrativeVariant;
    if (narrativeVariant) {
      warnings.push(
        `row ${ordinal + 1} links to a stored transaction whose narrative renders differently`,
      );
    }

    let category: string | null = null;
    if (result.kind === "new") {
      const hit = firstMatchingRule(effectiveRules, {
        accountId: account.id,
        payee,
        fingerprint: narrativeFingerprint(candidate.csv.raw.narrative),
        amount: candidate.csv.amount,
      });
      if (hit !== null) {
        ruleHits.set(ordinal, hit);
        category = hit.categoryName;
      }
    }

    candidates.push({
      ordinal,
      postedDate: candidate.csv.postedDate,
      amount: aud(candidate.csv.amount),
      narrative: displayNarrative(candidate.csv.raw.narrative),
      payee,
      status: result.kind,
      tier: result.kind === "duplicate" ? result.tier : result.kind === "new" ? "new" : null,
      transactionId: result.kind === "duplicate" ? result.transactionId : null,
      options: result.kind === "ambiguous" ? result.options : [],
      narrativeVariant,
      category,
    });
  }

  const coverage = yield* computeCoverageEffects(sql, account.id, segment);
  const fingerprint = yield* fingerprintOf(digest, candidates, segment);

  return {
    kind: "new",
    account,
    digest,
    profile: pairedProfileName,
    files,
    bundle,
    outcomes,
    window: bundle.window,
    identityHmac,
    maskedSuffix: ofx.account.acctId.slice(-4),
    candidates,
    ruleHits,
    coverage,
    balances: {
      ledger: bundle.ledger?.amount ?? null,
      available: bundle.available?.amount ?? null,
      ledgerReconciled: bundle.ledgerReconciled,
    },
    warnings,
    fingerprint,
  };
});

const effectCounts = (candidates: readonly CandidateEffect[]) => ({
  new: candidates.filter((candidate) => candidate.status === "new").length,
  duplicate: candidates.filter((candidate) => candidate.status === "duplicate").length,
  ambiguous: candidates.filter((candidate) => candidate.status === "ambiguous").length,
});

const toPreview = (computation: Computation): BankImportPreview => {
  const { account, files } = computation;
  const fileViews = files.map((file) => ({
    role: file.role,
    displayName: file.displayName,
    digest: file.digest,
    byteSize: file.bytes.length,
  }));

  if (computation.kind === "replay") {
    const total =
      computation.import.effects.new +
      computation.import.effects.duplicate +
      computation.import.effects.ambiguous;
    return {
      accountId: account.id,
      sourceProfile: computation.profile,
      window: { start: computation.import.windowStart, end: computation.import.windowEnd },
      files: fileViews,
      bundleDigest: computation.digest,
      previewFingerprint: computation.digest,
      logicalTransactions: total,
      physicalObservations: total * 2,
      effects: computation.import.effects,
      candidates: [],
      balances: { ledger: null, available: null, ledgerReconciled: false },
      coverage: { added: [], overlapRetained: [], gapsRemaining: [] },
      warnings: ["this exact bundle is already confirmed; confirming again changes nothing"],
      reviewCount: 0,
      alreadyConfirmed: true,
    };
  }

  return {
    accountId: account.id,
    sourceProfile: computation.profile,
    window: computation.window,
    files: fileViews,
    bundleDigest: computation.digest,
    previewFingerprint: computation.fingerprint,
    logicalTransactions: computation.candidates.length,
    physicalObservations: computation.candidates.length * 2,
    effects: effectCounts(computation.candidates),
    candidates: computation.candidates,
    balances: {
      ledger: computation.balances.ledger === null ? null : aud(computation.balances.ledger),
      available:
        computation.balances.available === null ? null : aud(computation.balances.available),
      ledgerReconciled: computation.balances.ledgerReconciled,
    },
    coverage: {
      added: computation.coverage.added,
      overlapRetained: computation.coverage.overlapRetained,
      gapsRemaining: computation.coverage.gapsRemaining,
    },
    warnings: computation.warnings,
    reviewCount: computation.candidates.filter(
      (candidate) => candidate.status === "new" && candidate.category === null,
    ).length,
    alreadyConfirmed: false,
  };
};

const getAccountOrFail = (sql: SqlExecutor, accountId: BankAccountId) =>
  Effect.gen(function* () {
    const account = yield* getAccount(sql, accountId);
    if (account === null) {
      return yield* Effect.fail(new NotFound({ entity: "bank account", id: accountId }));
    }
    return account;
  });

/** Stateless preview: the full parse and match against a consistent snapshot. */
export const previewBankImport = (
  source: BankImportSource,
  deps: ImportDeps,
): Effect.Effect<PreviewBankImportResult, ValidationFailed | NotFound | Internal, Postgres> =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;

    return yield* postgres.readTransaction((sql) =>
      Effect.gen(function* () {
        const account = yield* getAccountOrFail(sql, source.accountId);
        const computation = yield* computeStructured(sql, source, deps, account);
        return { kind: "ready", preview: toPreview(computation) } as const;
      }).pipe(
        Effect.catchIf(
          (error): error is BankImportBlocked => error instanceof BankImportBlocked,
          (error) => Effect.succeed({ kind: "blocked", block: error.block } as const),
        ),
      ),
    );
  }).pipe(persistenceToBoundary);

export interface ConfirmBankImportInput {
  readonly source: BankImportSource;
  readonly expectedBundleDigest: Sha256;
  readonly expectedPreviewFingerprint: Sha256;
  readonly resolutions: readonly AmbiguityResolution[];
  readonly requestId: RequestId;
}

interface ResolvedLink {
  readonly transactionId: BankTransactionId | null;
}

/**
 * Applies the operator's explicit decisions to the ambiguous candidates.
 * Every ambiguity needs exactly one decision, a link must name one of the
 * candidate's own options, and claim-once holds across resolutions too.
 */
const applyResolutions = Effect.fn("applyResolutions")(function* (
  outcomes: readonly MatchOutcome[],
  resolutions: readonly AmbiguityResolution[],
): Effect.fn.Return<ReadonlyMap<number, ResolvedLink>, ValidationFailed> {
  const byOrdinal = new Map(resolutions.map((resolution) => [resolution.ordinal, resolution]));
  const claimed = new Set<BankTransactionId>();
  const links = new Map<number, ResolvedLink>();

  for (const [ordinal, outcome] of outcomes.entries()) {
    if (outcome.result.kind !== "ambiguous") continue;
    const resolution = byOrdinal.get(ordinal);
    if (resolution === undefined) {
      return yield* Effect.fail(
        new ValidationFailed({
          reason: "UnresolvedAmbiguity",
          detail: `candidate ${ordinal} needs an explicit decision`,
        }),
      );
    }
    if (resolution.decision.kind === "new") {
      links.set(ordinal, { transactionId: null });
      continue;
    }
    const target = resolution.decision.transactionId;
    if (!outcome.result.options.includes(target) || claimed.has(target)) {
      return yield* Effect.fail(
        new ValidationFailed({
          reason: "InvalidResolution",
          detail: `candidate ${ordinal} cannot link to ${target}`,
        }),
      );
    }
    claimed.add(target);
    links.set(ordinal, { transactionId: target });
  }

  return links;
});

const confirmPayloadHash = (input: ConfirmBankImportInput): Promise<string> =>
  sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        digest: input.expectedBundleDigest,
        fingerprint: input.expectedPreviewFingerprint,
        resolutions: input.resolutions,
      }),
    ),
  );

export const confirmBankImport = (
  input: ConfirmBankImportInput,
  deps: ImportDeps,
): Effect.Effect<
  ConfirmBankImportResult,
  ValidationFailed | NotFound | Conflict | Stale | Internal,
  Postgres
> =>
  Effect.gen(function* () {
    const payloadHash = decodeSha(yield* Effect.promise(() => confirmPayloadHash(input)));
    const postgres = yield* Postgres;
    const preflight = yield* postgres.readTransaction((sql) =>
      Effect.gen(function* () {
        const account = yield* getAccountOrFail(sql, input.source.accountId);
        return yield* computeStructured(sql, input.source, deps, account).pipe(
          Effect.catchIf(
            (error): error is BankImportBlocked => error instanceof BankImportBlocked,
            (error) => Effect.succeed(error),
          ),
        );
      }),
    );

    if (
      !(preflight instanceof BankImportBlocked) &&
      preflight.digest !== input.expectedBundleDigest
    ) {
      return yield* Effect.fail(
        new Conflict({
          reason: "ImportBytesChanged",
          detail: "the uploaded bytes differ from the previewed bundle",
        }),
      );
    }

    if (!(preflight instanceof BankImportBlocked) && preflight.kind === "new") {
      yield* Effect.forEach(
        preflight.files,
        (file) =>
          Effect.tryPromise({
            try: () => deps.artifacts.put(artifactKey(preflight.digest, file), file.bytes),
            catch: (cause) => new PersistenceError({ operation: "write source artifact", cause }),
          }),
        { concurrency: "unbounded", discard: true },
      );
    }

    return yield* runIdempotentMutation(
      {
        requestId: input.requestId,
        operation: "confirmBankImport",
        payloadHash,
        response: ConfirmBankImportResult,
      },
      (sql) =>
        Effect.gen(function* () {
          // The per-account advisory lock: two confirms for one account
          // serialize; different accounts proceed independently.
          yield* sql.query(
            "lock bank account for confirm",
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`bank-import:${input.source.accountId}`],
          );

          const account = yield* getAccountOrFail(sql, input.source.accountId);
          const computation = yield* computeStructured(sql, input.source, deps, account).pipe(
            Effect.catchIf(
              (error): error is BankImportBlocked => error instanceof BankImportBlocked,
              (error) => Effect.succeed(error),
            ),
          );
          if (computation instanceof BankImportBlocked) {
            return { kind: "blocked", block: computation.block } as const;
          }

          if (computation.digest !== input.expectedBundleDigest) {
            return yield* Effect.fail(
              new Conflict({
                reason: "ImportBytesChanged",
                detail: "the uploaded bytes differ from the previewed bundle",
              }),
            );
          }

          if (computation.kind === "replay") {
            return {
              kind: "confirmed",
              importId: computation.import.id,
              effects: computation.import.effects,
              coverageAdded: [],
            } as const;
          }

          if (computation.fingerprint !== input.expectedPreviewFingerprint) {
            return yield* Effect.fail(
              new Stale({
                reason: "PreviewStale",
                detail: "the record moved since preview; preview again",
              }),
            );
          }

          const graph = yield* buildGraph(computation, input.resolutions);

          yield* insertConfirmedImport(sql, computation.account, graph);
          yield* enqueueCategorizationBatches(sql, graph);
          yield* detectOwnedTransfers(
            sql,
            graph.transactions.map((transaction) => transaction.id),
          );
          yield* emitCoverageEvents(
            sql,
            computation.account,
            computation.coverage.gapsBefore,
            computation.coverage.gapsRemaining,
          );
          yield* emitDerivedEvents(
            sql,
            new Set(graph.transactions.map((transaction) => monthOf(transaction.postedDate))),
          );
          yield* generateMonthlySpendingReports(sql);

          if (computation.account.identityHmac === null) {
            yield* bindAccountIdentity(
              sql,
              computation.account.id,
              computation.identityHmac,
              computation.maskedSuffix,
            );
          }

          return {
            kind: "confirmed",
            importId: graph.importRow.id,
            effects: graph.importRow.effects,
            coverageAdded: computation.coverage.added,
          } as const;
        }),
    );
  }).pipe(persistenceToBoundary);

export const artifactKey = (digest: Sha256, file: { role: string; digest: Sha256 }): string =>
  `exports/commbank/${digest}/${file.role}-${file.digest}`;

/** Everything confirm writes, minted and assembled outside the SQL calls. */
const buildGraph = Effect.fn("buildImportGraph")(function* (
  computation: NewImportComputation,
  resolutions: readonly AmbiguityResolution[],
): Effect.fn.Return<ConfirmedImportGraph, ValidationFailed> {
  const account = computation.account;
  const importId = yield* mintId(BankImportId);
  const fileIds = new Map<string, BankSourceFileId>();
  for (const file of computation.files) {
    fileIds.set(file.role, yield* mintId(BankSourceFileId));
  }

  const files = computation.files.map((file) => ({
    id: fileIds.get(file.role)!,
    role: file.role,
    mediaType: file.mediaType,
    byteDigest: file.digest,
    byteSize: file.bytes.length,
    r2Key: artifactKey(computation.digest, file),
    displayName: file.displayName,
    extractor: file.extractor,
  }));

  const transactions: ConfirmedImportGraph["transactions"][number][] = [];
  const observations: ConfirmedImportGraph["observations"][number][] = [];
  const identifiers: ConfirmedImportGraph["identifiers"][number][] = [];
  const balances: ConfirmedImportGraph["balances"][number][] = [];
  const splits: ConfirmedImportGraph["splits"][number][] = [];
  let created = 0;
  let linked = 0;

  const newTransaction = function* (
    ordinal: number,
    postedDate: CalendarDate,
    amount: BigDecimal.BigDecimal,
    narrative: string,
    rowBalance: BigDecimal.BigDecimal | null,
  ) {
    const wire = computation.candidates[ordinal]!;
    const transactionId = yield* mintId(BankTransactionId);
    created += 1;

    transactions.push({
      id: transactionId,
      postedDate,
      amount,
      displayNarrative: wire.narrative,
      derivedPayee: wire.payee,
      fingerprint: narrativeFingerprint(narrative),
      rowBalance,
      normalizerVersion,
    });

    const hit = computation.ruleHits.get(ordinal);
    splits.push({
      id: yield* mintId(TransactionSplitId),
      transactionId,
      categoryId: hit?.categoryId ?? uncategorizedCategoryId,
      amount,
      provenance: hit === undefined ? "system" : "rule",
      ruleId: hit?.id ?? null,
    });

    return transactionId;
  };

  const { bundle, outcomes } = computation;
  const rules = pairedRules[account.accountType];
  const links = yield* applyResolutions(outcomes, resolutions);
  const csvFileId = fileIds.get("csv")!;
  const ofxFileId = fileIds.get("ofx")!;

  for (const [ordinal, outcome] of outcomes.entries()) {
    const { candidate, result } = outcome;

    let transactionId: BankTransactionId;
    let tier: ConfirmedImportGraph["observations"][number]["matchTier"];
    let decidedBy: "cascade" | "operator" = "cascade";
    let isNew = false;

    if (result.kind === "duplicate") {
      transactionId = result.transactionId;
      tier = result.tier;
      linked += 1;
    } else if (result.kind === "ambiguous" && links.get(ordinal)!.transactionId !== null) {
      transactionId = links.get(ordinal)!.transactionId!;
      tier = "content";
      decidedBy = "operator";
      linked += 1;
    } else {
      transactionId = yield* newTransaction(
        ordinal,
        candidate.csv.postedDate,
        candidate.csv.amount,
        candidate.csv.raw.narrative,
        candidate.csv.balance,
      );
      tier = "new";
      decidedBy = result.kind === "ambiguous" ? "operator" : "cascade";
      isNew = true;

      if (rules.fitids === "verified") {
        identifiers.push({ fitid: candidate.ofx.fitid, transactionId });
      }
    }

    const csvObservationId = yield* mintId(BankObservationId);
    observations.push(
      {
        id: csvObservationId,
        sourceFileId: csvFileId,
        sourceOrdinal: candidate.csv.ordinal,
        raw: candidate.csv.raw,
        parsed: parsedCsv(candidate),
        parserVersion,
        transactionId,
        matchTier: tier,
        decidedBy,
        rowBalance: candidate.csv.balance,
        postedDate: candidate.csv.postedDate,
      },
      {
        id: yield* mintId(BankObservationId),
        sourceFileId: ofxFileId,
        sourceOrdinal: candidate.ofx.ordinal,
        raw: candidate.ofx.raw,
        parsed: parsedOfx(candidate),
        parserVersion,
        transactionId,
        matchTier: tier,
        decidedBy,
        rowBalance: null,
        postedDate: candidate.csv.postedDate,
      },
    );

    if (isNew && candidate.csv.balance !== null) {
      balances.push({
        id: yield* mintId(BalanceObservationId),
        kind: "row",
        value: candidate.csv.balance,
        asOfDate: candidate.csv.postedDate,
        observationId: csvObservationId,
        sourceFileId: null,
      });
    }
  }

  if (bundle.ledger !== null) {
    balances.push({
      id: yield* mintId(BalanceObservationId),
      kind: "ledger",
      value: bundle.ledger.amount,
      asOfDate: bundle.ledger.asOfDate,
      observationId: null,
      sourceFileId: ofxFileId,
    });
  }
  if (bundle.available !== null) {
    balances.push({
      id: yield* mintId(BalanceObservationId),
      kind: "available",
      value: bundle.available.amount,
      asOfDate: bundle.available.asOfDate,
      observationId: null,
      sourceFileId: ofxFileId,
    });
  }

  const effects = {
    new: created,
    duplicate: linked,
    ambiguous: resolutions.length,
  };

  const window = computation.window;
  const importRow: ImportRow = {
    id: importId,
    accountId: account.id,
    sourceProfile: computation.profile,
    bundleDigest: computation.digest,
    windowStart: window.start,
    windowEnd: window.end,
    effects,
  };

  const feedEvent: ConfirmedImportGraph["feedEvent"] = {
    id: yield* mintId(FeedEventId),
    origin: "money",
    category: "money_tax",
    eventType: "bank_import_completed",
    severity: "info",
    summary: `${account.productLabel}: ${created} new, ${linked} duplicate across ${computation.candidates.length} rows`,
    payload: {
      importId,
      accountId: account.id,
      sourceProfile: computation.profile,
      window,
      effects,
      coverageAdded: computation.coverage.added,
    },
    links: { import: importId },
  };

  return {
    importRow,
    files,
    transactions,
    observations,
    identifiers,
    balances,
    splits,
    ambiguities: yield* Effect.forEach(resolutions, (resolution) =>
      Effect.map(mintId(AmbiguityResolutionId), (id) => ({
        id,
        subject: { ordinal: resolution.ordinal },
        resolution: resolution.decision,
      })),
    ),
    coverage: {
      id: yield* mintId(CoverageSegmentId),
      span: computation.coverage.segment,
    },
    feedEvent,
  } satisfies ConfirmedImportGraph;
});

const parsedCsv = (candidate: PairedBundle["candidates"][number]) => ({
  postedDate: candidate.csv.postedDate,
  amount: BigDecimal.format(BigDecimal.normalize(candidate.csv.amount)),
  balance:
    candidate.csv.balance === null
      ? null
      : BigDecimal.format(BigDecimal.normalize(candidate.csv.balance)),
  occurrence: candidate.occurrence,
});

const parsedOfx = (candidate: PairedBundle["candidates"][number]) => ({
  posted: candidate.ofx.posted,
  valueDate: candidate.ofx.valueDate,
  amount: BigDecimal.format(BigDecimal.normalize(candidate.ofx.amount)),
  trnType: candidate.ofx.trnType,
  fitid: candidate.ofx.fitid,
  occurrence: candidate.occurrence,
});
