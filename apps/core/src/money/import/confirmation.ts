import { ValidationFailed, type AmbiguityResolution } from "@ironcage/contracts/schema";
import {
  AmbiguityResolutionId,
  BalanceObservationId,
  BankImportId,
  BankObservationId,
  BankObservationLinkId,
  BankSourceFileId,
  BankTransactionId,
  CoverageSegmentId,
  FeedEventId,
  TransactionSplitId,
  uncategorizedCategoryId,
  type CalendarDate,
} from "@ironcage/domain";
import { BigDecimal, Effect } from "effect";

import { mintId } from "../../ids";
import type { PairedBundle } from "./bundle";
import type { MatchOutcome } from "./matching";
import { narrativeFingerprint, normalizerVersion } from "./normalize";
import type { PendingImport } from "./prepared-import";
import { pairedRules } from "./profiles";
import type { ConfirmedImportGraph, ImportRow } from "./repository";

const parserVersion = 1;

interface ResolvedLink {
  readonly transactionId: BankTransactionId | null;
}

const applyResolutions = Effect.fn("applyImportResolutions")(function* (
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

/** Builds the complete graph that confirmation commits in one transaction. */
export const buildConfirmedImport = Effect.fn("buildConfirmedImport")(function* (
  prepared: PendingImport,
  resolutions: readonly AmbiguityResolution[],
): Effect.fn.Return<ConfirmedImportGraph, ValidationFailed> {
  const account = prepared.account;
  const importId = yield* mintId(BankImportId);
  const fileIds = new Map<string, BankSourceFileId>();
  for (const file of prepared.files) {
    fileIds.set(file.role, yield* mintId(BankSourceFileId));
  }

  const files = prepared.files.map((file) => ({
    id: fileIds.get(file.role)!,
    role: file.role,
    mediaType: file.mediaType,
    byteDigest: file.digest,
    byteSize: file.bytes.length,
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

  const createTransaction = function* (
    ordinal: number,
    postedDate: CalendarDate,
    amount: BigDecimal.BigDecimal,
    narrative: string,
    rowBalance: BigDecimal.BigDecimal | null,
  ) {
    const candidate = prepared.candidates[ordinal]!;
    const transactionId = yield* mintId(BankTransactionId);
    created += 1;
    transactions.push({
      id: transactionId,
      postedDate,
      amount,
      displayNarrative: candidate.narrative,
      derivedPayee: candidate.payee,
      fingerprint: narrativeFingerprint(narrative),
      rowBalance,
      normalizerVersion,
    });

    const hit = prepared.ruleHits.get(ordinal);
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

  if (prepared.plan.kind === "structured") {
    const { bundle, outcomes } = prepared.plan;
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
        transactionId = yield* createTransaction(
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
          linkId: yield* mintId(BankObservationLinkId),
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
          linkId: yield* mintId(BankObservationLinkId),
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
  } else {
    const { statement, matches } = prepared.plan;
    if (resolutions.length > 0) {
      return yield* Effect.fail(
        new ValidationFailed({
          reason: "InvalidResolution",
          detail: "a statement import carries no operator ambiguities",
        }),
      );
    }
    const markdownFileId = fileIds.get("extracted_markdown")!;

    for (const [ordinal, match] of matches.entries()) {
      const transactionId =
        match.transactionId ??
        (yield* createTransaction(
          ordinal,
          match.row.postedDate,
          match.row.amount,
          match.row.narrative,
          match.row.balance,
        ));
      const tier = match.transactionId === null ? "new" : "statement";
      if (match.transactionId !== null) linked += 1;

      const observationId = yield* mintId(BankObservationId);
      observations.push({
        id: observationId,
        linkId: yield* mintId(BankObservationLinkId),
        sourceFileId: markdownFileId,
        sourceOrdinal: match.row.ordinal,
        raw: {
          narrative: match.row.narrative,
          balance: BigDecimal.format(BigDecimal.normalize(match.row.balance)),
        },
        parsed: {
          postedDate: match.row.postedDate,
          amount: BigDecimal.format(BigDecimal.normalize(match.row.amount)),
          balance: BigDecimal.format(BigDecimal.normalize(match.row.balance)),
        },
        parserVersion,
        transactionId,
        matchTier: tier,
        decidedBy: "cascade",
        rowBalance: match.row.balance,
        postedDate: match.row.postedDate,
      });

      if (match.transactionId === null) {
        balances.push({
          id: yield* mintId(BalanceObservationId),
          kind: "row",
          value: match.row.balance,
          asOfDate: match.row.postedDate,
          observationId,
          sourceFileId: null,
        });
      }
    }

    balances.push(
      {
        id: yield* mintId(BalanceObservationId),
        kind: "opening",
        value: statement.opening,
        asOfDate: statement.period.start,
        observationId: null,
        sourceFileId: markdownFileId,
      },
      {
        id: yield* mintId(BalanceObservationId),
        kind: "closing",
        value: statement.closing,
        asOfDate: statement.period.end,
        observationId: null,
        sourceFileId: markdownFileId,
      },
    );
  }

  const effects = { new: created, duplicate: linked, ambiguous: resolutions.length };
  const importRow: ImportRow = {
    id: importId,
    accountId: account.id,
    sourceProfile: prepared.profile,
    bundleDigest: prepared.digest,
    windowStart: prepared.window.start,
    windowEnd: prepared.window.end,
    effects,
  };
  const feedEvent: ConfirmedImportGraph["feedEvent"] = {
    id: yield* mintId(FeedEventId),
    origin: "money",
    category: "money_tax",
    eventType: "bank_import_completed",
    severity: "info",
    summary: `${account.productLabel}: ${created} new, ${linked} duplicate across ${prepared.candidates.length} rows`,
    payload: {
      importId,
      accountId: account.id,
      sourceProfile: prepared.profile,
      window: prepared.window,
      effects,
      coverageAdded: prepared.coverage.added,
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
      span: prepared.coverage.segment,
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
