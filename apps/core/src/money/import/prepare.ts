import {
  NotFound,
  type BankImportPreview,
  type BankImportSource,
  type CandidateEffect,
} from "@ironcage/contracts/schema";
import {
  addDays,
  Aud,
  BankTransactionId,
  CalendarDate,
  Sha256,
  type BankAccountId,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import type { PersistenceError } from "../../persistence/error";
import type { SqlExecutor } from "../../persistence/postgres";
import { findAccountByIdentity, getAccount, type AccountRow } from "../accounts/records";
import { loadEffectiveRules } from "../categorization/effective-rules";
import { firstMatchingRule, type EffectiveRule } from "../categorization/rules";
import { BankImportBlocked, blocked } from "./block";
import { bundleDigest, validatePairedBundle } from "./bundle";
import { sha256Hex } from "./bytes";
import { parseOffsetStatement } from "./commbank-offset-statement";
import { coverageGaps, mergeSpans, type CoveredSpan } from "./coverage";
import { parseBankCsv } from "./csv";
import { matchCandidates, type StoredTransaction } from "./matching";
import { derivePayee, displayNarrative, narrativeFingerprint } from "./normalize";
import { parseBankOfx } from "./ofx";
import {
  statementProfileName,
  type ImportDependencies,
  type PreparedImport,
  type PreparedSourceFile,
  type ReplayedImport,
  type StatementMatch,
} from "./prepared-import";
import { accountIdentityInput, hmacSha256Hex, pairedProfileName, pairedRules } from "./profiles";
import {
  findImportByDigest,
  loadBalanceEvidenceRange,
  loadCoverageSpans,
  loadEvidence,
  type ImportRow,
} from "./store";

const statementDateDriftDays = 3;
const decodeAud = Schema.decodeUnknownSync(Aud);
const decodeCalendarDate = Schema.decodeUnknownSync(CalendarDate);
const decodeSha = Schema.decodeUnknownSync(Sha256);
const accountLifeStart = decodeCalendarDate("0001-01-01");
const accountLifeEnd = decodeCalendarDate("9999-12-31");

const aud = (value: BigDecimal.BigDecimal) =>
  decodeAud(BigDecimal.format(BigDecimal.normalize(value)));

const intersect = (a: CoveredSpan, b: CoveredSpan): CoveredSpan | null => {
  const start = a.start > b.start ? a.start : b.start;
  const end = a.end < b.end ? a.end : b.end;
  return start <= end ? { start, end } : null;
};

const prepareSourceFile = (
  role: PreparedSourceFile["role"],
  bytes: Uint8Array,
  displayName: string,
  mediaType: string,
  extractor: PreparedSourceFile["extractor"] = null,
) =>
  Effect.map(
    Effect.promise(() => sha256Hex(bytes)),
    (digest): PreparedSourceFile => ({
      role,
      bytes,
      displayName,
      digest: decodeSha(digest),
      mediaType,
      extractor,
    }),
  );

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
  start: account.openedOn ?? accountLifeStart,
  end: account.closedOn ?? accountLifeEnd,
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

  return { segment, added, overlapRetained, gapsBefore, gapsRemaining };
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

const replayedImport = (
  account: AccountRow,
  digest: Sha256,
  profile: ReplayedImport["profile"],
  files: readonly PreparedSourceFile[],
  replay: ImportRow,
): ReplayedImport => ({ kind: "replay", account, digest, profile, files, import: replay });

const prepareStructuredImport = Effect.fn("prepareStructuredImport")(function* (
  sql: SqlExecutor,
  source: Extract<BankImportSource, { kind: "commbank_structured" }>,
  deps: ImportDependencies,
  account: AccountRow,
): Effect.fn.Return<PreparedImport, BankImportBlocked | PersistenceError> {
  const files = [
    yield* prepareSourceFile("csv", source.csv.bytes, source.csv.displayName, "text/csv"),
    yield* prepareSourceFile("ofx", source.ofx.bytes, source.ofx.displayName, "application/x-ofx"),
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

  const replay = yield* findImportByDigest(sql, account.id, digest);
  if (replay !== null) return replayedImport(account, digest, pairedProfileName, files, replay);

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
  return {
    kind: "pending",
    account,
    digest,
    profile: pairedProfileName,
    files,
    plan: { kind: "structured", bundle, outcomes },
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
    fingerprint: yield* fingerprintOf(digest, candidates, segment),
  };
});

/**
 * Statement rows may print a nearby date, so overlap identity comes from the
 * exact amount and running balance. Any disagreement inside complete
 * structured coverage blocks the import instead of inventing history.
 */
const prepareStatementImport = Effect.fn("prepareStatementImport")(function* (
  sql: SqlExecutor,
  source: Extract<BankImportSource, { kind: "commbank_statement" }>,
  deps: ImportDependencies,
  account: AccountRow,
): Effect.fn.Return<PreparedImport, BankImportBlocked | PersistenceError> {
  if (account.accountType !== "deposit") {
    return yield* blocked(
      "StatementGrammar",
      `${statementProfileName} covers offset accounts; ${account.productLabel} is ${account.accountType}`,
    );
  }

  const pdfFile = yield* prepareSourceFile(
    "pdf",
    source.pdf.bytes,
    source.pdf.displayName,
    "application/pdf",
  );
  const digest = decodeSha(
    yield* Effect.promise(() =>
      bundleDigest(statementProfileName, account.id, [
        { role: pdfFile.role, digest: pdfFile.digest },
      ]),
    ),
  );
  const replay = yield* findImportByDigest(sql, account.id, digest);
  if (replay !== null) {
    return replayedImport(account, digest, statementProfileName, [pdfFile], replay);
  }

  const extraction = yield* Effect.tryPromise({
    try: () => deps.extractStatement(source.pdf.bytes),
    catch: (cause) =>
      new BankImportBlocked({
        code: "StatementNeedsManualExtraction",
        detail: cause instanceof Error ? cause.message : "extraction failed",
      }),
  });
  const markdownBytes = new TextEncoder().encode(extraction.markdown);
  const markdownFile = yield* prepareSourceFile(
    "extracted_markdown",
    markdownBytes,
    `${source.pdf.displayName}.md`,
    "text/markdown",
    extraction.extractor,
  );
  const files = [pdfFile, markdownFile];
  const statement = yield* parseOffsetStatement(extraction.markdown);

  const digits = statement.accountNumber.split(" ");
  const bankId = digits.slice(0, 2).join("");
  const acctId = digits.slice(2).join("");
  if (bankId.length !== 6 || acctId.length === 0) {
    return yield* blocked(
      "StatementGrammar",
      `unrecognized account number shape "${statement.accountNumber}"`,
    );
  }
  const identityHmac = yield* Effect.promise(() =>
    hmacSha256Hex(deps.identityKey, accountIdentityInput(account.accountType, { bankId, acctId })),
  );
  yield* verifyIdentity(sql, account, identityHmac);

  const segment = intersect(statement.period, accountLife(account));
  if (segment === null) {
    return yield* blocked(
      "WindowOutsideAccountLifetime",
      `${statement.period.start}..${statement.period.end} is outside the account's life`,
    );
  }

  const stored = yield* loadBalanceEvidenceRange(
    sql,
    account.id,
    addDays(statement.period.start, -7),
    addDays(statement.period.end, 7),
  );
  const key = (amount: BigDecimal.BigDecimal, balance: BigDecimal.BigDecimal) =>
    `${BigDecimal.format(BigDecimal.normalize(amount))}|${BigDecimal.format(BigDecimal.normalize(balance))}`;
  const byKey = new Map<string, StoredTransaction[]>();
  for (const transaction of stored) {
    if (transaction.rowBalance === null) continue;
    const signature = key(transaction.amount, transaction.rowBalance);
    const group = byKey.get(signature);
    if (group === undefined) byKey.set(signature, [transaction]);
    else group.push(transaction);
  }

  const coverageSpans = mergeSpans(yield* loadCoverageSpans(sql, account.id));
  const covered = (date: CalendarDate) =>
    coverageSpans.some((span) => span.start <= date && date <= span.end);
  const nearCoverageEdge = (date: CalendarDate) =>
    coverageSpans.some(
      (span) =>
        (date >= addDays(span.start, -statementDateDriftDays) &&
          date <= addDays(span.start, statementDateDriftDays)) ||
        (date >= addDays(span.end, -statementDateDriftDays) &&
          date <= addDays(span.end, statementDateDriftDays)),
    );

  const claimed = new Set<BankTransactionId>();
  const matches: StatementMatch[] = [];
  for (const row of statement.rows) {
    const group = (byKey.get(key(row.amount, row.balance)) ?? []).filter(
      (transaction) => !claimed.has(transaction.id),
    );
    if (group.length > 1) {
      return yield* blocked(
        "StatementOverlapMismatch",
        `row ${row.ordinal + 1} maps to ${group.length} stored transactions`,
      );
    }
    const match = group[0];
    if (match !== undefined) {
      claimed.add(match.id);
      matches.push({ row, transactionId: match.id });
      continue;
    }
    if (covered(row.postedDate) && !nearCoverageEdge(row.postedDate)) {
      return yield* blocked(
        "StatementOverlapMismatch",
        `row ${row.ordinal + 1} (${row.postedDate}) lies inside complete structured coverage but matches nothing`,
      );
    }
    matches.push({ row, transactionId: null });
  }

  for (const transaction of stored) {
    if (transaction.rowBalance === null || claimed.has(transaction.id)) continue;
    if (
      transaction.postedDate >= addDays(statement.period.start, statementDateDriftDays) &&
      transaction.postedDate <= addDays(statement.period.end, -statementDateDriftDays) &&
      covered(transaction.postedDate)
    ) {
      return yield* blocked(
        "StatementOverlapMismatch",
        `stored transaction on ${transaction.postedDate} has no statement counterpart`,
      );
    }
  }

  const effectiveRules = yield* loadEffectiveRules(sql);
  const ruleHits = new Map<number, EffectiveRule>();
  const candidates: CandidateEffect[] = [];
  for (const [ordinal, match] of matches.entries()) {
    const narrative = displayNarrative(match.row.narrative);
    const payee = derivePayee(match.row.narrative, "deposit");
    let category: string | null = null;
    if (match.transactionId === null) {
      const hit = firstMatchingRule(effectiveRules, {
        accountId: account.id,
        payee,
        fingerprint: narrativeFingerprint(match.row.narrative),
        amount: match.row.amount,
      });
      if (hit !== null) {
        ruleHits.set(ordinal, hit);
        category = hit.categoryName;
      }
    }
    candidates.push({
      ordinal,
      postedDate: match.row.postedDate,
      amount: aud(match.row.amount),
      narrative,
      payee,
      status: match.transactionId === null ? "new" : "duplicate",
      tier: match.transactionId === null ? "new" : "statement",
      transactionId: match.transactionId,
      options: [],
      narrativeVariant: false,
      category,
    });
  }

  const coverage = yield* computeCoverageEffects(sql, account.id, segment);
  return {
    kind: "pending",
    account,
    digest,
    profile: statementProfileName,
    files,
    plan: { kind: "statement", statement, matches },
    window: statement.period,
    identityHmac,
    maskedSuffix: acctId.slice(-4),
    candidates,
    ruleHits,
    coverage,
    balances: { ledger: statement.closing, available: null, ledgerReconciled: true },
    warnings: [],
    fingerprint: yield* fingerprintOf(digest, candidates, segment),
  };
});

const getAccountOrFail = (sql: SqlExecutor, accountId: BankAccountId) =>
  Effect.gen(function* () {
    const account = yield* getAccount(sql, accountId);
    if (account === null) {
      return yield* Effect.fail(new NotFound({ entity: "bank account", id: accountId }));
    }
    return account;
  });

export const prepareBankImport = Effect.fn("prepareBankImport")(function* (
  sql: SqlExecutor,
  source: BankImportSource,
  deps: ImportDependencies,
) {
  const account = yield* getAccountOrFail(sql, source.accountId);
  if (source.kind === "commbank_structured") {
    return yield* prepareStructuredImport(sql, source, deps, account);
  }
  return yield* prepareStatementImport(sql, source, deps, account);
});

const effectCounts = (candidates: readonly CandidateEffect[]) => ({
  new: candidates.filter((candidate) => candidate.status === "new").length,
  duplicate: candidates.filter((candidate) => candidate.status === "duplicate").length,
  ambiguous: candidates.filter((candidate) => candidate.status === "ambiguous").length,
});

export const toBankImportPreview = (prepared: PreparedImport): BankImportPreview => {
  const files = prepared.files.map((file) => ({
    role: file.role,
    displayName: file.displayName,
    digest: file.digest,
    byteSize: file.bytes.length,
  }));

  if (prepared.kind === "replay") {
    const total =
      prepared.import.effects.new +
      prepared.import.effects.duplicate +
      prepared.import.effects.ambiguous;
    return {
      accountId: prepared.account.id,
      sourceProfile: prepared.profile,
      window: { start: prepared.import.windowStart, end: prepared.import.windowEnd },
      files,
      bundleDigest: prepared.digest,
      previewFingerprint: prepared.digest,
      logicalTransactions: total,
      physicalObservations: total * (prepared.profile === pairedProfileName ? 2 : 1),
      effects: prepared.import.effects,
      candidates: [],
      balances: { ledger: null, available: null, ledgerReconciled: false },
      coverage: { added: [], overlapRetained: [], gapsRemaining: [] },
      warnings: ["this exact bundle is already confirmed; confirming again changes nothing"],
      reviewCount: 0,
      alreadyConfirmed: true,
    };
  }

  return {
    accountId: prepared.account.id,
    sourceProfile: prepared.profile,
    window: prepared.window,
    files,
    bundleDigest: prepared.digest,
    previewFingerprint: prepared.fingerprint,
    logicalTransactions: prepared.candidates.length,
    physicalObservations:
      prepared.candidates.length * (prepared.plan.kind === "structured" ? 2 : 1),
    effects: effectCounts(prepared.candidates),
    candidates: prepared.candidates,
    balances: {
      ledger: prepared.balances.ledger === null ? null : aud(prepared.balances.ledger),
      available: prepared.balances.available === null ? null : aud(prepared.balances.available),
      ledgerReconciled: prepared.balances.ledgerReconciled,
    },
    coverage: {
      added: prepared.coverage.added,
      overlapRetained: prepared.coverage.overlapRetained,
      gapsRemaining: prepared.coverage.gapsRemaining,
    },
    warnings: prepared.warnings,
    reviewCount: prepared.candidates.filter(
      (candidate) => candidate.status === "new" && candidate.category === null,
    ).length,
    alreadyConfirmed: false,
  };
};
