import {
  AmbiguityResolutionId,
  BalanceObservationId,
  BankAccountId,
  BankImportId,
  BankObservationId,
  BankSourceFileId,
  BankTransactionId,
  CalendarDate,
  CategorizationRuleId,
  CategoryId,
  CoverageSegmentId,
  MatchTier,
  Sha256,
  SourceFileRole,
  SourceProfile,
  TransactionSplitId,
  type Instant,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import type { PersistenceError, SqlExecutor } from "../../persistence";
import type { AccountRow } from "../accounts/repository";
import { insertFeedEvent, type FeedEventInsert } from "../feed/repository";
import type { CoveredSpan } from "./coverage";
import type { StoredEvidence, StoredIdentifier, StoredTransaction } from "./matching";

const Decimal = Schema.BigDecimalFromString;

const ImportRowSchema = Schema.Struct({
  id: BankImportId,
  accountId: BankAccountId,
  sourceProfile: SourceProfile,
  bundleDigest: Sha256,
  windowStart: CalendarDate,
  windowEnd: CalendarDate,
  effects: Schema.Struct({
    new: Schema.Int,
    duplicate: Schema.Int,
    ambiguous: Schema.Int,
  }),
});
export type ImportRow = typeof ImportRowSchema.Type;

export const findImportByDigest = (
  sql: SqlExecutor,
  accountId: BankAccountId,
  bundleDigest: string,
) =>
  Effect.gen(function* () {
    const rows = yield* sql.rows(
      "find bank import by digest",
      ImportRowSchema,
      `SELECT id, account_id AS "accountId", source_profile AS "sourceProfile",
              bundle_digest AS "bundleDigest", window_start AS "windowStart",
              window_end AS "windowEnd", effects
         FROM bank_imports WHERE account_id = $1 AND bundle_digest = $2`,
      [accountId, bundleDigest],
    );
    return rows[0] ?? null;
  });

const EvidenceRow = Schema.Struct({
  id: BankTransactionId,
  postedDate: CalendarDate,
  amount: Decimal,
  fingerprint: Schema.String,
  rowBalance: Schema.NullOr(Decimal),
});

const IdentifierRow = Schema.Struct({
  fitid: Schema.String,
  transactionId: BankTransactionId,
  postedDate: CalendarDate,
  amount: Decimal,
  fingerprint: Schema.String,
});

/**
 * The cascade's view of the record: canonical transactions on the candidate
 * dates in creation order, and the verified identifier index for the FITIDs
 * this bundle carries.
 */
export const loadEvidence = (
  sql: SqlExecutor,
  accountId: BankAccountId,
  profile: string,
  dates: readonly CalendarDate[],
  fitids: readonly string[],
): Effect.Effect<StoredEvidence, PersistenceError> =>
  Effect.gen(function* () {
    const transactions: readonly StoredTransaction[] = yield* sql.rows(
      "load stored transactions",
      EvidenceRow,
      `SELECT id, posted_date AS "postedDate", amount::text AS amount,
              narrative_fingerprint AS "fingerprint", row_balance::text AS "rowBalance"
         FROM bank_transactions
        WHERE account_id = $1 AND posted_date = ANY($2::date[])
        ORDER BY id`,
      [accountId, [...dates]],
    );
    const identifiers = new Map<string, StoredIdentifier>();
    if (fitids.length > 0) {
      const identifierRows = yield* sql.rows(
        "load stored identifiers",
        IdentifierRow,
        `SELECT si.fitid, si.transaction_id AS "transactionId", t.posted_date AS "postedDate",
                t.amount::text AS amount, t.narrative_fingerprint AS "fingerprint"
           FROM bank_source_identifiers si
           JOIN bank_transactions t ON t.id = si.transaction_id
          WHERE si.account_id = $1 AND si.source_profile = $2 AND si.fitid = ANY($3::text[])`,
        [accountId, profile, [...fitids]],
      );
      for (const row of identifierRows) {
        identifiers.set(row.fitid, row);
      }
    }

    return { transactions, identifiers };
  });

/** Statement dates can drift from structured dates, so the overlap lookup is range-based. */
export const loadBalanceEvidenceRange = (
  sql: SqlExecutor,
  accountId: BankAccountId,
  from: CalendarDate,
  to: CalendarDate,
): Effect.Effect<readonly StoredTransaction[], PersistenceError> =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "load stored transactions by range",
      EvidenceRow,
      `SELECT id, posted_date AS "postedDate", amount::text AS amount,
              narrative_fingerprint AS "fingerprint", row_balance::text AS "rowBalance"
         FROM bank_transactions
        WHERE account_id = $1 AND posted_date BETWEEN $2 AND $3
        ORDER BY id`,
      [accountId, from, to],
    );
  });

const SpanRow = Schema.Struct({ start: CalendarDate, end: CalendarDate });

export const loadCoverageSpans = (
  sql: SqlExecutor,
  accountId: BankAccountId,
): Effect.Effect<readonly CoveredSpan[], PersistenceError> =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "load coverage segments",
      SpanRow,
      `SELECT start_date AS "start", end_date AS "end"
         FROM bank_coverage_segments WHERE account_id = $1 AND status = 'complete'
        ORDER BY start_date`,
      [accountId],
    );
  });

const money = (value: BigDecimal.BigDecimal | null) =>
  value === null ? null : BigDecimal.format(BigDecimal.normalize(value));

export interface ObservationInsert {
  readonly id: BankObservationId;
  readonly sourceFileId: BankSourceFileId;
  readonly sourceOrdinal: number;
  readonly raw: unknown;
  readonly parsed: unknown;
  readonly parserVersion: number;
  readonly transactionId: BankTransactionId;
  readonly matchTier: MatchTier;
  readonly decidedBy: "cascade" | "operator";
  readonly rowBalance: BigDecimal.BigDecimal | null;
  readonly postedDate: CalendarDate;
}

export interface TransactionInsert {
  readonly id: BankTransactionId;
  readonly postedDate: CalendarDate;
  readonly amount: BigDecimal.BigDecimal;
  readonly displayNarrative: string;
  readonly derivedPayee: string;
  readonly fingerprint: string;
  readonly rowBalance: BigDecimal.BigDecimal | null;
  readonly normalizerVersion: number;
}

export interface SplitInsert {
  readonly id: TransactionSplitId;
  readonly transactionId: BankTransactionId;
  readonly categoryId: CategoryId;
  readonly amount: BigDecimal.BigDecimal;
  readonly provenance: "system" | "rule";
  readonly ruleId: CategorizationRuleId | null;
}

export interface IdentifierInsert {
  readonly fitid: string;
  readonly transactionId: BankTransactionId;
}

export interface BalanceInsert {
  readonly id: BalanceObservationId;
  readonly kind: "row" | "ledger" | "available" | "opening" | "closing";
  readonly value: BigDecimal.BigDecimal;
  readonly asOfDate: CalendarDate;
  readonly observationId: BankObservationId | null;
  readonly sourceFileId: BankSourceFileId | null;
}

export interface SourceFileInsert {
  readonly id: BankSourceFileId;
  readonly role: SourceFileRole;
  readonly mediaType: string;
  readonly byteDigest: Sha256;
  readonly byteSize: number;
  readonly displayName: string;
  readonly extractor: unknown;
}

export interface AmbiguityInsert {
  readonly id: AmbiguityResolutionId;
  readonly subject: unknown;
  readonly resolution: unknown;
}

export interface ConfirmedImportGraph {
  readonly importRow: ImportRow;
  readonly files: readonly SourceFileInsert[];
  readonly transactions: readonly TransactionInsert[];
  readonly observations: readonly ObservationInsert[];
  readonly identifiers: readonly IdentifierInsert[];
  readonly balances: readonly BalanceInsert[];
  readonly splits: readonly SplitInsert[];
  readonly ambiguities: readonly AmbiguityInsert[];
  readonly coverage: { readonly id: CoverageSegmentId; readonly span: CoveredSpan } | null;
  readonly feedEvent: FeedEventInsert;
}

/**
 * The Money commit point: every row of a confirmed import in the one open
 * transaction the caller already holds, alongside its feed event.
 */
export const insertConfirmedImport = (
  sql: SqlExecutor,
  account: AccountRow,
  graph: ConfirmedImportGraph,
): Effect.Effect<void, PersistenceError> =>
  Effect.gen(function* () {
    const { importRow } = graph;

    yield* sql.execute(
      "insert bank import",
      `INSERT INTO bank_imports
         (id, account_id, source_profile, bundle_digest, window_start, window_end, status, effects, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7::jsonb, now())`,
      [
        importRow.id,
        importRow.accountId,
        importRow.sourceProfile,
        importRow.bundleDigest,
        importRow.windowStart,
        importRow.windowEnd,
        JSON.stringify(importRow.effects),
      ],
    );

    if (graph.files.length > 0) {
      yield* sql.execute(
        "insert bank source files",
        `INSERT INTO bank_source_files
           (id, import_id, role, media_type, byte_digest, byte_size, display_name, extractor)
         SELECT x.id::uuid, $1, x.role, x.media_type, x.byte_digest, x.byte_size,
                x.display_name, x.extractor
           FROM jsonb_to_recordset($2::jsonb) AS x(
             id text, role text, media_type text, byte_digest text, byte_size integer,
             display_name text, extractor jsonb
           )`,
        [
          importRow.id,
          JSON.stringify(
            graph.files.map((file) => ({
              id: file.id,
              role: file.role,
              media_type: file.mediaType,
              byte_digest: file.byteDigest,
              byte_size: file.byteSize,
              display_name: file.displayName,
              extractor: file.extractor,
            })),
          ),
        ],
      );
    }

    if (graph.transactions.length > 0) {
      yield* sql.execute(
        "insert bank transactions",
        `INSERT INTO bank_transactions
           (id, account_id, posted_date, amount, currency, display_narrative, derived_payee,
            narrative_fingerprint, row_balance, normalizer_version, created_by_import, created_at)
         SELECT x.id::uuid, $1, x.posted_date::date, x.amount::numeric, $2,
                x.display_narrative, x.derived_payee, x.fingerprint, x.row_balance::numeric,
                x.normalizer_version, $3, now()
           FROM jsonb_to_recordset($4::jsonb) AS x(
             id text, posted_date text, amount text, display_narrative text,
             derived_payee text, fingerprint text, row_balance text, normalizer_version integer
           )`,
        [
          account.id,
          account.currency,
          importRow.id,
          JSON.stringify(
            graph.transactions.map((transaction) => ({
              id: transaction.id,
              posted_date: transaction.postedDate,
              amount: money(transaction.amount),
              display_narrative: transaction.displayNarrative,
              derived_payee: transaction.derivedPayee,
              fingerprint: transaction.fingerprint,
              row_balance: money(transaction.rowBalance),
              normalizer_version: transaction.normalizerVersion,
            })),
          ),
        ],
      );
    }

    if (graph.observations.length > 0) {
      const observations = JSON.stringify(
        graph.observations.map((observation) => ({
          id: observation.id,
          source_file_id: observation.sourceFileId,
          source_ordinal: observation.sourceOrdinal,
          raw: observation.raw,
          parsed: observation.parsed,
          parser_version: observation.parserVersion,
          transaction_id: observation.transactionId,
          match_tier: observation.matchTier,
          decided_by: observation.decidedBy,
        })),
      );
      yield* sql.execute(
        "insert bank observations",
        `INSERT INTO bank_observations
           (id, source_file_id, source_ordinal, raw, parsed, parser_version, parse_status)
         SELECT x.id::uuid, x.source_file_id::uuid, x.source_ordinal, x.raw, x.parsed,
                x.parser_version, 'parsed'
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id text, source_file_id text, source_ordinal integer, raw jsonb, parsed jsonb,
             parser_version integer
           )`,
        [observations],
      );
      yield* sql.execute(
        "insert bank observation links",
        `INSERT INTO bank_observation_links
           (id, observation_id, transaction_id, import_id, match_tier, decided_by, created_at)
         SELECT gen_random_uuid(), x.id::uuid, x.transaction_id::uuid, $1,
                x.match_tier, x.decided_by, now()
           FROM jsonb_to_recordset($2::jsonb) AS x(
             id text, transaction_id text, match_tier text, decided_by text
           )`,
        [importRow.id, observations],
      );
    }

    if (graph.identifiers.length > 0) {
      yield* sql.execute(
        "insert bank source identifiers",
        `INSERT INTO bank_source_identifiers (account_id, source_profile, fitid, transaction_id)
         SELECT $1, $2, x.fitid, x.transaction_id::uuid
           FROM jsonb_to_recordset($3::jsonb) AS x(fitid text, transaction_id text)`,
        [
          account.id,
          importRow.sourceProfile,
          JSON.stringify(
            graph.identifiers.map((identifier) => ({
              fitid: identifier.fitid,
              transaction_id: identifier.transactionId,
            })),
          ),
        ],
      );
    }

    if (graph.balances.length > 0) {
      yield* sql.execute(
        "insert bank balance observations",
        `INSERT INTO bank_balance_observations
           (id, account_id, kind, value, as_of_date, as_of_time, observation_id, source_file_id)
         SELECT x.id::uuid, $1, x.kind, x.value::numeric, x.as_of_date::date, NULL,
                x.observation_id::uuid, x.source_file_id::uuid
           FROM jsonb_to_recordset($2::jsonb) AS x(
             id text, kind text, value text, as_of_date text,
             observation_id text, source_file_id text
           )`,
        [
          account.id,
          JSON.stringify(
            graph.balances.map((balance) => ({
              id: balance.id,
              kind: balance.kind,
              value: money(balance.value),
              as_of_date: balance.asOfDate,
              observation_id: balance.observationId,
              source_file_id: balance.sourceFileId,
            })),
          ),
        ],
      );
    }

    if (graph.splits.length > 0) {
      yield* sql.execute(
        "insert transaction splits",
        `INSERT INTO transaction_splits (id, transaction_id, revision, category_id, amount, provenance, rule_id, created_at)
         SELECT x.id::uuid, x.transaction_id::uuid, 1, x.category_id::uuid,
                x.amount::numeric, x.provenance, x.rule_id::uuid, now()
           FROM jsonb_to_recordset($1::jsonb) AS x(
             id text, transaction_id text, category_id text, amount text,
             provenance text, rule_id text
           )`,
        [
          JSON.stringify(
            graph.splits.map((split) => ({
              id: split.id,
              transaction_id: split.transactionId,
              category_id: split.categoryId,
              amount: money(split.amount),
              provenance: split.provenance,
              rule_id: split.ruleId,
            })),
          ),
        ],
      );
    }

    if (graph.ambiguities.length > 0) {
      yield* sql.execute(
        "insert ambiguity resolutions",
        `INSERT INTO bank_ambiguity_resolutions (id, import_id, subject, resolution, resolved_at)
         SELECT x.id::uuid, $1, x.subject, x.resolution, now()
           FROM jsonb_to_recordset($2::jsonb) AS x(
             id text, subject jsonb, resolution jsonb
           )`,
        [importRow.id, JSON.stringify(graph.ambiguities)],
      );
    }

    if (graph.coverage !== null) {
      yield* sql.execute(
        "insert coverage segment",
        `INSERT INTO bank_coverage_segments (id, account_id, start_date, end_date, source_profile, import_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'complete')`,
        [
          graph.coverage.id,
          account.id,
          graph.coverage.span.start,
          graph.coverage.span.end,
          importRow.sourceProfile,
          importRow.id,
        ],
      );
    }

    yield* insertFeedEvent(sql, graph.feedEvent);
  }).pipe(Effect.asVoid);

const HistoryRow = Schema.Struct({
  importId: BankImportId,
  accountId: BankAccountId,
  productLabel: Schema.String,
  sourceProfile: SourceProfile,
  windowStart: CalendarDate,
  windowEnd: CalendarDate,
  effects: Schema.Struct({ new: Schema.Int, duplicate: Schema.Int, ambiguous: Schema.Int }),
  confirmedAt: Schema.DateTimeUtcFromDate,
  files: Schema.Array(
    Schema.Struct({ role: SourceFileRole, displayName: Schema.String, digest: Sha256 }),
  ),
});
export type HistoryRow = typeof HistoryRow.Type;

const ImportedTransactionRow = Schema.Struct({
  id: BankTransactionId,
  postedDate: CalendarDate,
});

export const loadImportedTransactions = (sql: SqlExecutor, importId: BankImportId) =>
  sql.rows(
    "load imported transactions",
    ImportedTransactionRow,
    `SELECT DISTINCT t.id, t.posted_date AS "postedDate"
       FROM bank_observation_links l
       JOIN bank_transactions t ON t.id = l.transaction_id
      WHERE l.import_id = $1
      ORDER BY t.id`,
    [importId],
  );

export const listImportHistory = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    return yield* sql.rows(
      "list import history",
      HistoryRow,
      `SELECT i.id AS "importId", i.account_id AS "accountId", a.product_label AS "productLabel",
              i.source_profile AS "sourceProfile", i.window_start AS "windowStart",
              i.window_end AS "windowEnd", i.effects, i.confirmed_at AS "confirmedAt",
              COALESCE(
                (SELECT jsonb_agg(jsonb_build_object('role', f.role, 'displayName', f.display_name, 'digest', f.byte_digest) ORDER BY f.role)
                   FROM bank_source_files f WHERE f.import_id = i.id),
                '[]'::jsonb
              ) AS files
         FROM bank_imports i JOIN bank_accounts a ON a.id = i.account_id
        ORDER BY i.confirmed_at DESC
        LIMIT 200`,
    );
  });

export const latestConfirmedAt = (
  sql: SqlExecutor,
): Effect.Effect<Instant | null, PersistenceError> =>
  Effect.gen(function* () {
    const rows = yield* sql.rows(
      "latest confirmed import",
      Schema.Struct({ latest: Schema.NullOr(Schema.DateTimeUtcFromDate) }),
      "SELECT max(confirmed_at) AS latest FROM bank_imports",
    );
    return rows[0]?.latest ?? null;
  });
