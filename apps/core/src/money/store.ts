import {
  BankAccountId,
  BankAccountType,
  BankImportId,
  BankObservationId,
  BankSourceFileId,
  BankTransactionId,
  CalendarDate,
  CategorizationRuleId,
  CategoryId,
  FeedEventId,
  MatchTier,
  RulePredicate,
  Sha256,
  SourceFileRole,
  SourceProfile,
  type Instant,
} from "@ironcage/domain";
import { BigDecimal, Effect, Schema } from "effect";

import { decodeRows, type PersistenceError, type SqlExecutor } from "../persistence";
import type { StoredEvidence, StoredIdentifier, StoredTransaction } from "./cascade";
import type { CoveredSpan } from "./coverage";
import type { EffectiveRule } from "./rules";

const Decimal = Schema.BigDecimalFromString;

export const AccountRow = Schema.Struct({
  id: BankAccountId,
  bank: Schema.String,
  productLabel: Schema.String,
  accountType: BankAccountType,
  maskedSuffix: Schema.NullOr(Schema.String),
  identityHmac: Schema.NullOr(Schema.String),
  currency: Schema.String,
  required: Schema.Boolean,
  openedOn: Schema.NullOr(CalendarDate),
  closedOn: Schema.NullOr(CalendarDate),
});
export type AccountRow = typeof AccountRow.Type;

const accountColumns = `id, bank, product_label AS "productLabel", account_type AS "accountType",
  masked_suffix AS "maskedSuffix", identity_hmac AS "identityHmac", currency, required,
  opened_on AS "openedOn", closed_on AS "closedOn"`;

export const getAccount = (sql: SqlExecutor, id: BankAccountId) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "read bank account",
      `SELECT ${accountColumns} FROM bank_accounts WHERE id = $1`,
      [id],
    );
    const accounts = yield* decodeRows("decode bank account", AccountRow, rows);
    return accounts[0] ?? null;
  });

export const listAccounts = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "list bank accounts",
      `SELECT ${accountColumns} FROM bank_accounts ORDER BY created_at`,
    );
    return yield* decodeRows("decode bank accounts", AccountRow, rows);
  });

export const findAccountByIdentity = (sql: SqlExecutor, bank: string, identityHmac: string) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "find bank account by identity",
      `SELECT ${accountColumns} FROM bank_accounts WHERE bank = $1 AND identity_hmac = $2`,
      [bank, identityHmac],
    );
    const accounts = yield* decodeRows("decode bank account", AccountRow, rows);
    return accounts[0] ?? null;
  });

export const insertAccount = (
  sql: SqlExecutor,
  account: AccountRow,
): Effect.Effect<void, PersistenceError> =>
  sql
    .query(
      "insert bank account",
      `INSERT INTO bank_accounts
         (id, bank, product_label, account_type, masked_suffix, identity_hmac, currency,
          required, opened_on, closed_on, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        account.id,
        account.bank,
        account.productLabel,
        account.accountType,
        account.maskedSuffix,
        account.identityHmac,
        account.currency,
        account.required,
        account.openedOn,
        account.closedOn,
      ],
    )
    .pipe(Effect.asVoid);

export const bindAccountIdentity = (
  sql: SqlExecutor,
  accountId: BankAccountId,
  identityHmac: string,
  maskedSuffix: string,
): Effect.Effect<void, PersistenceError> =>
  sql
    .query(
      "bind bank account identity",
      `UPDATE bank_accounts SET identity_hmac = $2, masked_suffix = $3
        WHERE id = $1 AND identity_hmac IS NULL`,
      [accountId, identityHmac, maskedSuffix],
    )
    .pipe(Effect.asVoid);

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
    const rows = yield* sql.query(
      "find bank import by digest",
      `SELECT id, account_id AS "accountId", source_profile AS "sourceProfile",
              bundle_digest AS "bundleDigest", window_start AS "windowStart",
              window_end AS "windowEnd", effects
         FROM bank_imports WHERE account_id = $1 AND bundle_digest = $2`,
      [accountId, bundleDigest],
    );
    const imports = yield* decodeRows("decode bank import", ImportRowSchema, rows);
    return imports[0] ?? null;
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
    const transactionRows = yield* sql.query(
      "load stored transactions",
      `SELECT id, posted_date AS "postedDate", amount::text AS amount,
              narrative_fingerprint AS "fingerprint", row_balance::text AS "rowBalance"
         FROM bank_transactions
        WHERE account_id = $1 AND posted_date = ANY($2::date[])
        ORDER BY id`,
      [accountId, [...dates]],
    );
    const transactions: readonly StoredTransaction[] = yield* decodeRows(
      "decode stored transactions",
      EvidenceRow,
      transactionRows,
    );

    const identifiers = new Map<string, StoredIdentifier>();
    if (fitids.length > 0) {
      const identifierRows = yield* sql.query(
        "load stored identifiers",
        `SELECT si.fitid, si.transaction_id AS "transactionId", t.posted_date AS "postedDate",
                t.amount::text AS amount, t.narrative_fingerprint AS "fingerprint"
           FROM bank_source_identifiers si
           JOIN bank_transactions t ON t.id = si.transaction_id
          WHERE si.account_id = $1 AND si.source_profile = $2 AND si.fitid = ANY($3::text[])`,
        [accountId, profile, [...fitids]],
      );
      for (const row of yield* decodeRows(
        "decode stored identifiers",
        IdentifierRow,
        identifierRows,
      )) {
        identifiers.set(row.fitid, row);
      }
    }

    return { transactions, identifiers };
  });

const SpanRow = Schema.Struct({ start: CalendarDate, end: CalendarDate });

export const loadCoverageSpans = (
  sql: SqlExecutor,
  accountId: BankAccountId,
): Effect.Effect<readonly CoveredSpan[], PersistenceError> =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "load coverage segments",
      `SELECT start_date AS "start", end_date AS "end"
         FROM bank_coverage_segments WHERE account_id = $1 AND status = 'complete'
        ORDER BY start_date`,
      [accountId],
    );
    return yield* decodeRows("decode coverage segments", SpanRow, rows);
  });

const RuleRow = Schema.Struct({
  id: CategorizationRuleId,
  predicate: RulePredicate,
  categoryId: CategoryId,
  categoryName: Schema.String,
});

export const loadEffectiveRules = (
  sql: SqlExecutor,
): Effect.Effect<readonly EffectiveRule[], PersistenceError> =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "load effective rules",
      `SELECT r.id, r.predicate, r.category_id AS "categoryId", c.name AS "categoryName"
         FROM categorization_rules r
         JOIN categories c ON c.id = r.category_id
        WHERE r.effective_from <= now() AND (r.effective_to IS NULL OR r.effective_to > now())
        ORDER BY r.effective_from, r.id`,
    );
    return yield* decodeRows("decode effective rules", RuleRow, rows);
  });

export interface FeedEventInsert {
  readonly id: FeedEventId;
  readonly origin: string;
  readonly category: string;
  readonly eventType: string;
  readonly severity: "info" | "notice" | "warning" | "critical";
  readonly summary: string;
  readonly payload: unknown;
  readonly links: unknown;
}

export const insertFeedEvent = (
  sql: SqlExecutor,
  event: FeedEventInsert,
): Effect.Effect<void, PersistenceError> =>
  sql
    .query(
      "insert feed event",
      `INSERT INTO feed_events (id, occurred_at, origin, category, event_type, severity, summary, payload, links)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        event.id,
        event.origin,
        event.category,
        event.eventType,
        event.severity,
        event.summary,
        JSON.stringify(event.payload),
        event.links === null ? null : JSON.stringify(event.links),
      ],
    )
    .pipe(Effect.asVoid);

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
  readonly id: string;
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
  readonly id: string;
  readonly kind: "row" | "ledger" | "available";
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
  readonly r2Key: string;
  readonly displayName: string;
  readonly extractor: unknown;
}

export interface AmbiguityInsert {
  readonly id: string;
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
  readonly coverage: { readonly id: string; readonly span: CoveredSpan } | null;
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

    yield* sql.query(
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

    for (const file of graph.files) {
      yield* sql.query(
        "insert bank source file",
        `INSERT INTO bank_source_files
           (id, import_id, role, media_type, byte_digest, byte_size, r2_key, display_name, extractor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          file.id,
          importRow.id,
          file.role,
          file.mediaType,
          file.byteDigest,
          file.byteSize,
          file.r2Key,
          file.displayName,
          file.extractor === null ? null : JSON.stringify(file.extractor),
        ],
      );
    }

    for (const transaction of graph.transactions) {
      yield* sql.query(
        "insert bank transaction",
        `INSERT INTO bank_transactions
           (id, account_id, posted_date, amount, currency, display_narrative, derived_payee,
            narrative_fingerprint, row_balance, normalizer_version, created_by_import, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [
          transaction.id,
          account.id,
          transaction.postedDate,
          money(transaction.amount),
          account.currency,
          transaction.displayNarrative,
          transaction.derivedPayee,
          transaction.fingerprint,
          money(transaction.rowBalance),
          transaction.normalizerVersion,
          importRow.id,
        ],
      );
    }

    for (const observation of graph.observations) {
      yield* sql.query(
        "insert bank observation",
        `INSERT INTO bank_observations
           (id, source_file_id, source_ordinal, raw, parsed, parser_version, parse_status)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, 'parsed')`,
        [
          observation.id,
          observation.sourceFileId,
          observation.sourceOrdinal,
          JSON.stringify(observation.raw),
          JSON.stringify(observation.parsed),
          observation.parserVersion,
        ],
      );
      yield* sql.query(
        "insert bank observation link",
        `INSERT INTO bank_observation_links
           (id, observation_id, transaction_id, import_id, match_tier, decided_by, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now())`,
        [
          observation.id,
          observation.transactionId,
          importRow.id,
          observation.matchTier,
          observation.decidedBy,
        ],
      );
    }

    for (const identifier of graph.identifiers) {
      yield* sql.query(
        "insert bank source identifier",
        `INSERT INTO bank_source_identifiers (account_id, source_profile, fitid, transaction_id)
         VALUES ($1, $2, $3, $4)`,
        [account.id, importRow.sourceProfile, identifier.fitid, identifier.transactionId],
      );
    }

    for (const balance of graph.balances) {
      yield* sql.query(
        "insert bank balance observation",
        `INSERT INTO bank_balance_observations
           (id, account_id, kind, value, as_of_date, as_of_time, observation_id, source_file_id)
         VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)`,
        [
          balance.id,
          account.id,
          balance.kind,
          money(balance.value),
          balance.asOfDate,
          balance.observationId,
          balance.sourceFileId,
        ],
      );
    }

    for (const split of graph.splits) {
      yield* sql.query(
        "insert transaction split",
        `INSERT INTO transaction_splits (id, transaction_id, revision, category_id, amount, provenance, rule_id, created_at)
         VALUES ($1, $2, 1, $3, $4, $5, $6, now())`,
        [
          split.id,
          split.transactionId,
          split.categoryId,
          money(split.amount),
          split.provenance,
          split.ruleId,
        ],
      );
    }

    for (const ambiguity of graph.ambiguities) {
      yield* sql.query(
        "insert ambiguity resolution",
        `INSERT INTO bank_ambiguity_resolutions (id, import_id, subject, resolution, resolved_at)
         VALUES ($1, $2, $3::jsonb, $4::jsonb, now())`,
        [
          ambiguity.id,
          importRow.id,
          JSON.stringify(ambiguity.subject),
          JSON.stringify(ambiguity.resolution),
        ],
      );
    }

    if (graph.coverage !== null) {
      yield* sql.query(
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

export const listImportHistory = (sql: SqlExecutor) =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "list import history",
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
    return yield* decodeRows("decode import history", HistoryRow, rows);
  });

export const latestConfirmedAt = (
  sql: SqlExecutor,
): Effect.Effect<Instant | null, PersistenceError> =>
  Effect.gen(function* () {
    const rows = yield* sql.query(
      "latest confirmed import",
      "SELECT max(confirmed_at) AS latest FROM bank_imports",
    );
    const value = rows[0]?.["latest"];
    if (value == null) return null;
    return yield* decodeRows(
      "decode confirmed time",
      Schema.Struct({ latest: Schema.DateTimeUtcFromDate }),
      [{ latest: value }],
    ).pipe(Effect.map((decoded) => decoded[0]!.latest));
  });
