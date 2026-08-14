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
  type UploadedBytes,
} from "@ironcage/contracts/schema";
import {
  Aud,
  BankImportId,
  BankObservationId,
  BankSourceFileId,
  BankTransactionId,
  FeedEventId,
  Sha256,
  uncategorizedCategoryId,
  type BankAccountId,
  type CalendarDate,
  type RequestId,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { mintId, mintRawUuidV7 } from "../ids";
import { runIdempotentMutation } from "../persistence/app-requests";
import { PersistenceError, persistenceToBoundary } from "../persistence/error";
import { Postgres, type SqlExecutor } from "../persistence/postgres";
import { BankImportBlocked, blocked } from "./block";
import { bundleDigest, validatePairedBundle, type PairedBundle } from "./bundle";
import { sha256Hex } from "./bytes";
import { matchCandidates, type MatchOutcome } from "./cascade";
import { coverageGaps, mergeSpans, type CoveredSpan } from "./coverage";
import { parseBankCsv } from "./csv";
import {
  derivePayee,
  displayNarrative,
  narrativeFingerprint,
  normalizerVersion,
} from "./normalize";
import { parseBankOfx } from "./ofx";
import { accountIdentityInput, hmacSha256Hex, pairedProfileName, pairedRules } from "./profiles";
import { firstMatchingRule, type EffectiveRule } from "./rules";
import {
  bindAccountIdentity,
  findAccountByIdentity,
  findImportByDigest,
  getAccount,
  insertConfirmedImport,
  loadCoverageSpans,
  loadEffectiveRules,
  loadEvidence,
  type AccountRow,
  type ConfirmedImportGraph,
  type ImportRow,
} from "./store";
import { detectOwnedTransfers } from "./transfers";

/** The v1 structured-import parser version stored on every observation. */
const parserVersion = 1;

export interface ImportDeps {
  /** Keys the account-identity HMAC; provisioned per environment. */
  readonly identityKey: string;
  /** Content-addressed source artifacts; writes happen before the DB commit. */
  readonly artifacts: {
    readonly put: (key: string, bytes: Uint8Array) => Promise<unknown>;
  };
}

const decodeAud = Schema.decodeUnknownSync(Aud);
const decodeSha = Schema.decodeUnknownSync(Sha256);

const aud = (value: BigDecimal.BigDecimal) =>
  decodeAud(BigDecimal.format(BigDecimal.normalize(value)));

interface DigestedFile {
  readonly role: "csv" | "ofx";
  readonly upload: UploadedBytes;
  readonly digest: Sha256;
  readonly mediaType: string;
}

interface Computation {
  readonly account: AccountRow;
  readonly digest: Sha256;
  readonly files: readonly DigestedFile[];
  readonly replay: ImportRow | null;
  readonly bundle: PairedBundle | null;
  readonly outcomes: readonly MatchOutcome[];
  readonly identityHmac: string | null;
  readonly candidates: readonly CandidateEffect[];
  readonly ruleHits: ReadonlyMap<number, EffectiveRule>;
  readonly coverage: {
    readonly segment: CoveredSpan | null;
    readonly added: readonly CoveredSpan[];
    readonly overlapRetained: readonly CoveredSpan[];
    readonly gapsRemaining: readonly CoveredSpan[];
  };
  readonly warnings: readonly string[];
  readonly fingerprint: Sha256;
}

const structuredSource = (source: BankImportSource) =>
  source.kind === "commbank_structured"
    ? Effect.succeed(source)
    : Effect.fail(
        new ValidationFailed({
          reason: "UnsupportedSource",
          detail: "statement import arrives in the statement tranche",
        }),
      );

const intersect = (a: CoveredSpan, b: CoveredSpan): CoveredSpan | null => {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
};

/**
 * The whole import computation, run identically by preview (against a
 * read-only snapshot) and by confirm (under the account's advisory lock).
 * Everything runs in memory; the only writes belong to confirm's caller.
 */
const compute = Effect.fn("computeBankImport")(function* (
  sql: SqlExecutor,
  source: Extract<BankImportSource, { kind: "commbank_structured" }>,
  deps: ImportDeps,
  account: AccountRow,
): Effect.fn.Return<Computation, BankImportBlocked | PersistenceError> {
  const files: readonly DigestedFile[] = [
    {
      role: "csv",
      upload: source.csv,
      digest: decodeSha(yield* Effect.promise(() => sha256Hex(source.csv.bytes))),
      mediaType: "text/csv",
    },
    {
      role: "ofx",
      upload: source.ofx,
      digest: decodeSha(yield* Effect.promise(() => sha256Hex(source.ofx.bytes))),
      mediaType: "application/x-ofx",
    },
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

  const emptyCoverage = {
    segment: null,
    added: [],
    overlapRetained: [],
    gapsRemaining: [],
  } as const;

  // Tier 0: an identical confirmed bundle returns its earlier result and
  // nothing — no parser, category rule, or coverage mutation — runs again.
  const replay = yield* findImportByDigest(sql, account.id, digest);
  if (replay !== null) {
    return {
      account,
      digest,
      files,
      replay,
      bundle: null,
      outcomes: [],
      identityHmac: null,
      candidates: [],
      ruleHits: new Map(),
      coverage: emptyCoverage,
      warnings: [],
      fingerprint: digest,
    };
  }

  const rules = pairedRules[account.accountType];
  const csvRows = yield* parseBankCsv(source.csv.bytes, rules.csvBalances);
  const ofx = yield* parseBankOfx(source.ofx.bytes, rules.ofxVariant);
  const bundle = yield* validatePairedBundle(account.accountType, csvRows, ofx);

  const identityHmac = yield* Effect.promise(() =>
    hmacSha256Hex(deps.identityKey, accountIdentityInput(account.accountType, ofx.account)),
  );
  if (account.identityHmac !== null && account.identityHmac !== identityHmac) {
    return yield* blocked(
      "AccountMismatch",
      `the OFX identity does not match ${account.productLabel}`,
    );
  }
  const identityOwner = yield* findAccountByIdentity(sql, account.bank, identityHmac);
  if (identityOwner !== null && identityOwner.id !== account.id) {
    return yield* blocked(
      "AccountMismatch",
      `the OFX identity belongs to ${identityOwner.productLabel}`,
    );
  }

  const life: CoveredSpan = {
    start: account.openedOn ?? ("0001-01-01" as CalendarDate),
    end: account.closedOn ?? ("9999-12-31" as CalendarDate),
  };
  const segment = intersect(bundle.window, life);
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

  const existing = mergeSpans(yield* loadCoverageSpans(sql, account.id));
  const added = coverageGaps(existing, segment);
  const overlapRetained = existing.flatMap((span) => {
    const shared = intersect(span, segment);
    return shared === null ? [] : [shared];
  });
  const union = mergeSpans([...existing, segment]);
  const gapsRemaining =
    union.length === 0
      ? []
      : coverageGaps(union, { start: union[0]!.start, end: union[union.length - 1]!.end });

  const fingerprint = decodeSha(
    yield* Effect.promise(() =>
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
  );

  return {
    account,
    digest,
    files,
    replay: null,
    bundle,
    outcomes,
    identityHmac,
    candidates,
    ruleHits,
    coverage: { segment, added, overlapRetained, gapsRemaining },
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
  const { account, files, replay } = computation;

  if (replay !== null) {
    return {
      accountId: account.id,
      sourceProfile: pairedProfileName,
      window: { start: replay.windowStart, end: replay.windowEnd },
      files: files.map((file) => ({
        role: file.role,
        displayName: file.upload.displayName,
        digest: file.digest,
        byteSize: file.upload.bytes.length,
      })),
      bundleDigest: computation.digest,
      previewFingerprint: computation.fingerprint,
      logicalTransactions: replay.effects.new + replay.effects.duplicate + replay.effects.ambiguous,
      physicalObservations:
        (replay.effects.new + replay.effects.duplicate + replay.effects.ambiguous) * 2,
      effects: replay.effects,
      candidates: [],
      balances: { ledger: null, available: null, ledgerReconciled: false },
      coverage: { added: [], overlapRetained: [], gapsRemaining: [] },
      warnings: ["this exact bundle is already confirmed; confirming again changes nothing"],
      reviewCount: 0,
      alreadyConfirmed: true,
    };
  }

  const bundle = computation.bundle!;
  return {
    accountId: account.id,
    sourceProfile: pairedProfileName,
    window: bundle.window,
    files: files.map((file) => ({
      role: file.role,
      displayName: file.upload.displayName,
      digest: file.digest,
      byteSize: file.upload.bytes.length,
    })),
    bundleDigest: computation.digest,
    previewFingerprint: computation.fingerprint,
    logicalTransactions: bundle.candidates.length,
    physicalObservations: bundle.candidates.length * 2,
    effects: effectCounts(computation.candidates),
    candidates: computation.candidates,
    balances: {
      ledger: bundle.ledger === null ? null : aud(bundle.ledger.amount),
      available: bundle.available === null ? null : aud(bundle.available.amount),
      ledgerReconciled: bundle.ledgerReconciled,
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
    const structured = yield* structuredSource(source);
    const postgres = yield* Postgres;

    return yield* postgres.readTransaction((sql) =>
      Effect.gen(function* () {
        const account = yield* getAccountOrFail(sql, structured.accountId);
        const computation = yield* compute(sql, structured, deps, account);
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
  readonly tier: "new" | "duplicate" | "resolved";
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
      links.set(ordinal, { transactionId: null, tier: "resolved" });
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
    links.set(ordinal, { transactionId: target, tier: "resolved" });
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

/**
 * Digest-verified confirm. Recomputes the import under the account's advisory
 * lock, refuses moved bytes or a stale preview, writes source artifacts to R2
 * first, then commits the whole import graph and its feed event in the one
 * open Postgres transaction.
 */
export const confirmBankImport = (
  input: ConfirmBankImportInput,
  deps: ImportDeps,
): Effect.Effect<
  ConfirmBankImportResult,
  ValidationFailed | NotFound | Conflict | Stale | Internal,
  Postgres
> =>
  Effect.gen(function* () {
    const structured = yield* structuredSource(input.source);
    const payloadHash = decodeSha(yield* Effect.promise(() => confirmPayloadHash(input)));

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
            [`bank-import:${structured.accountId}`],
          );

          const account = yield* getAccountOrFail(sql, structured.accountId);
          const computation = yield* compute(sql, structured, deps, account).pipe(
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

          if (computation.replay !== null) {
            return {
              kind: "confirmed",
              importId: computation.replay.id,
              effects: computation.replay.effects,
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

          const links = yield* applyResolutions(computation.outcomes, input.resolutions);
          const graph = yield* buildGraph(computation, links, input.resolutions);

          // R2 first: a failure here leaves Postgres untouched, and a failed
          // transaction afterwards leaves only unreferenced immutable objects
          // whose digest keys a retry reuses.
          for (const file of computation.files) {
            yield* Effect.tryPromise({
              try: () =>
                deps.artifacts.put(artifactKey(computation.digest, file), file.upload.bytes),
              catch: (cause) => new PersistenceError({ operation: "write source artifact", cause }),
            });
          }

          yield* insertConfirmedImport(sql, computation.account, graph);
          yield* detectOwnedTransfers(
            sql,
            graph.transactions.map((transaction) => transaction.id),
          );

          if (computation.account.identityHmac === null && computation.identityHmac !== null) {
            yield* bindAccountIdentity(
              sql,
              computation.account.id,
              computation.identityHmac,
              maskedSuffix(structured),
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
  });

export const artifactKey = (digest: Sha256, file: DigestedFile): string =>
  `exports/commbank/${digest}/${file.role}-${file.digest}`;

const maskedSuffix = (source: Extract<BankImportSource, { kind: "commbank_structured" }>) => {
  const decoded = new TextDecoder().decode(source.ofx.bytes);
  const acctId = /<ACCTID>([^\r\n<]*)/.exec(decoded)?.[1] ?? "";
  return acctId.slice(-4);
};

/** Everything confirm writes, minted and assembled outside the SQL calls. */
const buildGraph = Effect.fn("buildImportGraph")(function* (
  computation: Computation,
  links: ReadonlyMap<number, ResolvedLink>,
  resolutions: readonly AmbiguityResolution[],
) {
  const account = computation.account;
  const bundle = computation.bundle!;
  const rules = pairedRules[account.accountType];
  const importId = yield* mintId(BankImportId);
  const csvFileId = yield* mintId(BankSourceFileId);
  const ofxFileId = yield* mintId(BankSourceFileId);

  const files = computation.files.map((file) => ({
    id: file.role === "csv" ? csvFileId : ofxFileId,
    role: file.role,
    mediaType: file.mediaType,
    byteDigest: file.digest,
    byteSize: file.upload.bytes.length,
    r2Key: artifactKey(computation.digest, file),
    displayName: file.upload.displayName,
    extractor: null,
  }));

  const transactions: ConfirmedImportGraph["transactions"][number][] = [];
  const observations: ConfirmedImportGraph["observations"][number][] = [];
  const identifiers: ConfirmedImportGraph["identifiers"][number][] = [];
  const balances: ConfirmedImportGraph["balances"][number][] = [];
  const splits: ConfirmedImportGraph["splits"][number][] = [];

  let created = 0;
  let linked = 0;

  for (const [ordinal, outcome] of computation.outcomes.entries()) {
    const { candidate, result } = outcome;
    const wire = computation.candidates[ordinal]!;

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
      transactionId = yield* mintId(BankTransactionId);
      tier = "new";
      decidedBy = result.kind === "ambiguous" ? "operator" : "cascade";
      isNew = true;
      created += 1;
    }

    if (isNew) {
      transactions.push({
        id: transactionId,
        postedDate: candidate.csv.postedDate,
        amount: candidate.csv.amount,
        displayNarrative: wire.narrative,
        derivedPayee: wire.payee,
        fingerprint: narrativeFingerprint(candidate.csv.raw.narrative),
        rowBalance: candidate.csv.balance,
        normalizerVersion,
      });

      const hit = computation.ruleHits.get(ordinal);
      splits.push({
        id: mintRawUuidV7(),
        transactionId,
        categoryId: hit?.categoryId ?? uncategorizedCategoryId,
        amount: candidate.csv.amount,
        provenance: hit === undefined ? "system" : "rule",
        ruleId: hit?.id ?? null,
      });

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
        id: mintRawUuidV7(),
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
      id: mintRawUuidV7(),
      kind: "ledger",
      value: bundle.ledger.amount,
      asOfDate: bundle.ledger.asOfDate,
      observationId: null,
      sourceFileId: ofxFileId,
    });
  }
  if (bundle.available !== null) {
    balances.push({
      id: mintRawUuidV7(),
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

  const importRow: ImportRow = {
    id: importId,
    accountId: account.id,
    sourceProfile: pairedProfileName,
    bundleDigest: computation.digest,
    windowStart: bundle.window.start,
    windowEnd: bundle.window.end,
    effects,
  };

  const feedEvent: ConfirmedImportGraph["feedEvent"] = {
    id: yield* mintId(FeedEventId),
    origin: "money",
    category: "money_tax",
    eventType: "bank_import_completed",
    severity: "info",
    summary: `${account.productLabel}: ${created} new, ${linked} duplicate across ${bundle.candidates.length} rows`,
    payload: {
      importId,
      accountId: account.id,
      sourceProfile: pairedProfileName,
      window: bundle.window,
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
    ambiguities: resolutions.map((resolution) => ({
      id: mintRawUuidV7(),
      subject: { ordinal: resolution.ordinal },
      resolution: resolution.decision,
    })),
    coverage:
      computation.coverage.segment === null
        ? null
        : { id: mintRawUuidV7(), span: computation.coverage.segment },
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
