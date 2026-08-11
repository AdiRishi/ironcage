import {
  ArchivedBankStatement,
  BankAccount,
  BankAccountId,
  BankImportHistoryItem,
  BankImportId,
  BankImportPreview,
  BankTransactionId,
  CalendarDate,
  CategoryId,
  CategorizationRuleId,
  CategorizationRulePredicate,
  ConfirmedBankImport,
  Currency,
  Money,
  RequestId,
  Sha256,
} from "@ironcage/domain";
import { BigDecimal, DateTime, Effect, Layer, Schema } from "effect";

import { PersistenceError } from "../persistence";
import type { StoredTransactionEvidence } from "./deduplication";
import {
  decodeRows,
  inReadTransaction,
  inTransaction,
  moneyRecordLock,
  type SqlExecutor,
  withClient,
} from "./postgres";
import {
  type AccountRegistrationOutcome,
  type ConfirmedImportPlan,
  type ImportSnapshot,
  MoneyAccountMissing,
  MoneyImportRepository,
  type MoneyTransaction,
  type StatementArchivePlan,
  type StoredBankAccount,
} from "./repository";

const AccountRow = Schema.Struct({
  id: BankAccountId,
  profile: Schema.Literals(["spending-offset", "savings-offset", "mastercard", "home-loan"]),
  label: Schema.String,
  type: Schema.Literals(["deposit", "credit_card", "credit_line"]),
  maskedSuffix: Schema.String,
  currency: Currency,
  required: Schema.Boolean,
  effectiveFrom: CalendarDate,
  effectiveTo: Schema.NullOr(CalendarDate),
  identityHmac: Sha256,
});

const EvidenceRow = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  postedDate: CalendarDate,
  amount: Money,
  preferredNarrative: Schema.String,
  sourceProfile: Schema.String,
  bankIdentifier: Schema.NullOr(Schema.String),
  rowBalance: Schema.NullOr(Money),
  narrativeFingerprint: Schema.String,
  equalRowOccurrence: Schema.Int,
});

const CoverageRow = Schema.Struct({
  accountId: BankAccountId,
  start: CalendarDate,
  end: CalendarDate,
});

const RuleRow = Schema.Struct({
  id: CategorizationRuleId,
  version: Schema.Int,
  predicate: CategorizationRulePredicate,
  categoryId: CategoryId,
  effectiveFrom: CalendarDate,
  retiredAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

const accountSql = `
  SELECT id,
         product_profile AS "profile",
         product_label AS "label",
         account_type AS "type",
         masked_suffix AS "maskedSuffix",
         currency,
         required,
         effective_from::text AS "effectiveFrom",
         effective_to::text AS "effectiveTo",
         identity_hmac AS "identityHmac"
    FROM bank_accounts`;

export const listAccountsWith = Effect.fn("MoneyPostgresRepository.listAccountsWith")(function* (
  sql: SqlExecutor,
) {
  const rows = yield* sql.query("list bank accounts", `${accountSql} ORDER BY product_label`);
  const decoded = yield* decodeRows("decode bank accounts", AccountRow, rows);
  return decoded.map(({ identityHmac: _, ...account }) => account);
});

const snapshotWith = Effect.fn("MoneyPostgresRepository.snapshotWith")(function* (
  sql: SqlExecutor,
  accountId: BankAccountId,
  requestId: RequestId | null,
): Effect.fn.Return<ImportSnapshot, PersistenceError | MoneyAccountMissing> {
  const accountRows = yield* sql.query("read bank account", `${accountSql} WHERE id = $1`, [
    accountId,
  ]);
  const account = (yield* decodeRows("decode bank account", AccountRow, accountRows))[0];

  if (account === undefined) return yield* new MoneyAccountMissing({ accountId });

  const accounts = yield* listAccountsWith(sql);
  const evidenceRows = yield* sql.query(
    "read transaction evidence",
    `SELECT t.id AS "transactionId",
            t.bank_account_id AS "accountId",
            t.posted_date::text AS "postedDate",
            t.amount::text AS "amount",
            t.preferred_display_narrative AS "preferredNarrative",
            i.profile_version AS "sourceProfile",
            o.bank_identifier AS "bankIdentifier",
            o.row_balance::text AS "rowBalance",
            o.narrative_fingerprint AS "narrativeFingerprint",
            o.equal_row_occurrence AS "equalRowOccurrence"
       FROM bank_transactions t
       JOIN bank_observation_links l ON l.transaction_id = t.id
       JOIN bank_observations o ON o.id = l.observation_id
       JOIN bank_source_files f ON f.id = o.source_file_id
       JOIN bank_imports i ON i.id = f.bank_import_id
      WHERE t.bank_account_id = $1
      ORDER BY t.id, o.id`,
    [accountId],
  );
  const evidence = yield* decodeRows("decode transaction evidence", EvidenceRow, evidenceRows);
  const grouped = new Map<BankTransactionId, StoredTransactionEvidence>();

  for (const row of evidence) {
    const current = grouped.get(row.transactionId);
    const observation = {
      sourceProfile: row.sourceProfile,
      bankIdentifier: row.bankIdentifier,
      rowBalance: row.rowBalance,
      narrativeFingerprint: row.narrativeFingerprint,
      equalRowOccurrence: row.equalRowOccurrence,
    };

    if (current === undefined) {
      grouped.set(row.transactionId, {
        transactionId: row.transactionId,
        accountId: row.accountId,
        postedDate: row.postedDate,
        amount: row.amount,
        preferredNarrative: row.preferredNarrative,
        observations: [observation],
      });
    } else {
      grouped.set(row.transactionId, {
        ...current,
        observations: [...current.observations, observation],
      });
    }
  }

  const coverageRows = yield* sql.query(
    "read bank coverage",
    `SELECT bank_account_id AS "accountId",
            start_date::text AS "start",
            end_date::text AS "end"
       FROM bank_coverage_segments
      WHERE status = 'complete'
      ORDER BY bank_account_id, start_date, end_date`,
  );
  const coverage = yield* decodeRows("decode bank coverage", CoverageRow, coverageRows);
  const ruleRows = yield* sql.query(
    "read categorization rules",
    `SELECT DISTINCT ON (id)
            id,
            version,
            predicate,
            category_id AS "categoryId",
            effective_from::text AS "effectiveFrom",
            retired_at AS "retiredAt"
       FROM categorization_rules
      ORDER BY id, version DESC`,
  );
  const decodedRules = yield* decodeRows("decode categorization rules", RuleRow, ruleRows);
  const rules = decodedRules.flatMap((rule) =>
    rule.retiredAt === null
      ? [
          {
            id: rule.id,
            version: rule.version,
            accountIds: rule.predicate.accountIds,
            direction: rule.predicate.direction,
            payeeEquals: rule.predicate.payeeEquals,
            narrativeIncludes: rule.predicate.narrativeIncludes,
            minimumAbsoluteAmount: rule.predicate.minimumAbsoluteAmount,
            maximumAbsoluteAmount: rule.predicate.maximumAbsoluteAmount,
            categoryId: rule.categoryId,
            effectiveFrom: rule.effectiveFrom,
          },
        ]
      : [],
  );
  const importRows = yield* sql.query(
    "read confirmed imports",
    `SELECT bundle_digest AS "bundleDigest", result, preview
       FROM bank_imports
      WHERE bank_account_id = $1
      ORDER BY confirmed_at`,
    [accountId],
  );
  const imports = yield* decodeRows(
    "decode confirmed imports",
    Schema.Struct({
      bundleDigest: Sha256,
      result: Schema.Unknown,
      preview: Schema.Unknown,
    }),
    importRows,
  );
  const archiveRows = yield* sql.query(
    "read statement archives",
    `SELECT byte_digest AS "digest",
            jsonb_build_object(
              'id', id,
              'accountId', bank_account_id,
              'digest', byte_digest,
              'r2Key', r2_key,
              'archivedAt', to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            ) AS result
       FROM bank_statement_archives
      WHERE bank_account_id = $1
      ORDER BY archived_at`,
    [accountId],
  );
  const statementArchives = yield* decodeRows(
    "decode statement archives",
    Schema.Struct({ digest: Sha256, result: Schema.Unknown }),
    archiveRows,
  );
  const requestRows =
    requestId === null
      ? []
      : yield* sql.query(
          "read money request",
          `SELECT request_id AS "requestId", operation, payload_hash AS "payloadHash", response
             FROM app_requests
            WHERE request_id = $1`,
          [requestId],
        );
  const requests = yield* decodeRows(
    "decode money requests",
    Schema.Struct({
      requestId: RequestId,
      operation: Schema.String,
      payloadHash: Sha256,
      response: Schema.Unknown,
    }),
    requestRows,
  );
  const transferRows = yield* sql.query(
    "read transfer pairs",
    `SELECT debit_transaction_id AS "debitTransactionId",
            credit_transaction_id AS "creditTransactionId",
            status
       FROM transfer_matches`,
  );
  const transferPairs = yield* decodeRows(
    "decode transfer pairs",
    Schema.Struct({
      debitTransactionId: BankTransactionId,
      creditTransactionId: BankTransactionId,
      status: Schema.Literals(["proposed", "confirmed", "rejected"]),
    }),
    transferRows,
  );
  const { identityHmac, ...publicAccount } = account;

  return {
    selectedAccount: { account: publicAccount, identityHmac },
    accounts,
    transactions: [...grouped.values()],
    coverage,
    rules,
    imports,
    statementArchives,
    requests,
    transferPairs,
  };
});

const registerAccountWith = Effect.fn("MoneyPostgresRepository.registerAccountWith")(function* (
  sql: SqlExecutor,
  input: {
    readonly account: StoredBankAccount;
    readonly requestId: RequestId;
    readonly requestPayloadHash: Sha256;
  },
): Effect.fn.Return<AccountRegistrationOutcome, PersistenceError> {
  const requests = yield* sql.query(
    "read account registration request",
    `SELECT operation, payload_hash AS "payloadHash", response
       FROM app_requests
      WHERE request_id = $1`,
    [input.requestId],
  );
  const previous = (yield* decodeRows(
    "decode account registration request",
    Schema.Struct({ operation: Schema.String, payloadHash: Sha256, response: Schema.Unknown }),
    requests,
  ))[0];

  if (previous !== undefined) {
    return previous.operation === "money.register_account" &&
      previous.payloadHash === input.requestPayloadHash
      ? { _tag: "Replay", response: previous.response }
      : { _tag: "RequestConflict", existingPayloadHash: previous.payloadHash };
  }

  const account = input.account.account;
  const accountConflicts = yield* sql.query(
    "find conflicting bank account",
    `SELECT id,
            CASE
              WHEN id = $1 THEN 'id'
              WHEN product_profile = $2 THEN 'profile'
              ELSE 'label'
            END AS field
       FROM bank_accounts
      WHERE id = $1 OR product_profile = $2 OR product_label = $3
      ORDER BY CASE WHEN id = $1 THEN 0 WHEN product_profile = $2 THEN 1 ELSE 2 END
      LIMIT 1`,
    [account.id, account.profile, account.label],
  );
  const accountConflict = (yield* decodeRows(
    "decode conflicting bank account",
    Schema.Struct({
      id: BankAccountId,
      field: Schema.Literals(["id", "label", "profile"]),
    }),
    accountConflicts,
  ))[0];
  if (accountConflict !== undefined) {
    return {
      _tag: "AccountConflict",
      field: accountConflict.field,
      existingAccountId: accountConflict.id,
    };
  }

  const identities = yield* sql.query(
    "find account identity",
    `SELECT id FROM bank_accounts WHERE bank_profile = 'commbank' AND identity_hmac = $1`,
    [input.account.identityHmac],
  );
  const existing = yield* decodeRows(
    "decode account identity",
    Schema.Struct({ id: BankAccountId }),
    identities,
  );

  if (existing[0] !== undefined) {
    return { _tag: "IdentityConflict", existingAccountId: existing[0].id };
  }

  yield* sql.query(
    "insert bank account",
    `INSERT INTO bank_accounts (
       id, bank_profile, product_profile, product_label, account_type, masked_suffix,
       identity_hmac, currency, required, effective_from, created_at
     ) VALUES ($1, 'commbank', $2, $3, $4, $5, $6, $7, $8, $9, now())`,
    [
      account.id,
      account.profile,
      account.label,
      account.type,
      account.maskedSuffix,
      input.account.identityHmac,
      "AUD",
      account.required,
      account.effectiveFrom,
    ],
  );
  yield* sql.query(
    "record account registration request",
    `INSERT INTO app_requests (request_id, operation, payload_hash, response, completed_at)
     VALUES ($1, 'money.register_account', $2, $3::jsonb, now())`,
    [
      input.requestId,
      input.requestPayloadHash,
      JSON.stringify(Schema.encodeSync(BankAccount)(account)),
    ],
  );

  return { _tag: "Applied", account };
});

const json = (value: unknown) => JSON.stringify(value);
const money = (value: Money) => BigDecimal.format(BigDecimal.normalize(value));

const commitCoverageStatusesWith = Effect.fn("MoneyPostgresRepository.commitCoverageStatusesWith")(
  function* (sql: SqlExecutor, plan: ConfirmedImportPlan, confirmedAt: Date) {
    for (const status of plan.coverageStatuses) {
      const previousRows = yield* sql.query(
        "read previous monthly coverage status",
        `SELECT complete
         FROM bank_month_coverage_observations
        WHERE bank_account_id = $1 AND calendar_month = $2
        ORDER BY observed_order DESC
        LIMIT 1`,
        [status.accountId, status.month],
      );
      const previous = (yield* decodeRows(
        "decode previous monthly coverage status",
        Schema.Struct({ complete: Schema.Boolean }),
        previousRows,
      ))[0];
      const eventType =
        previous === undefined && !status.complete
          ? ("bank_gap_detected" as const)
          : previous?.complete === false && status.complete
            ? ("bank_gap_closed" as const)
            : null;

      if (eventType !== null) {
        const closed = eventType === "bank_gap_closed";
        yield* sql.query(
          "insert bank coverage feed event",
          `INSERT INTO feed_events (
           id, occurred_at, origin, category, event_type, severity, summary, payload, links
         ) VALUES ($1,$2,'money','money',$3,$4,$5,$6::jsonb,$7::jsonb)`,
          [
            status.eventId,
            confirmedAt,
            eventType,
            closed ? "info" : "warning",
            closed
              ? `Coverage completed for ${status.accountId} in ${status.month}`
              : `Coverage is incomplete for ${status.accountId} in ${status.month}`,
            json({ accountId: status.accountId, month: status.month }),
            json({ import: plan.result.importId }),
          ],
        );
      }

      yield* sql.query(
        "record monthly coverage status",
        `INSERT INTO bank_month_coverage_observations (
         id, bank_import_id, bank_account_id, calendar_month, complete,
         feed_event_id, observed_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          status.id,
          plan.result.importId,
          status.accountId,
          status.month,
          status.complete,
          eventType === null ? null : status.eventId,
          confirmedAt,
        ],
      );
    }
  },
);

const commitImportWith = Effect.fn("MoneyPostgresRepository.commitImportWith")(function* (
  sql: SqlExecutor,
  accountId: BankAccountId,
  plan: ConfirmedImportPlan,
) {
  const result = plan.result;
  const confirmedAt = DateTime.toDateUtc(result.confirmedAt);
  yield* sql.query(
    "insert bank import",
    `INSERT INTO bank_imports (
       id, bank_account_id, profile_version, bundle_digest, preview_fingerprint,
       source_start, source_end, status, source_transactions, observation_count,
       new_transactions, duplicate_transactions, resolved_ambiguities, result, preview,
       confirmed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15)`,
    [
      result.importId,
      accountId,
      plan.sourceProfile,
      result.bundleDigest,
      plan.previewFingerprint,
      result.sourceWindow.start,
      result.sourceWindow.end,
      result.sourceTransactions,
      result.observations,
      result.newTransactions,
      result.duplicates,
      result.resolvedAmbiguities,
      json(Schema.encodeSync(ConfirmedBankImport)(result)),
      json(Schema.encodeSync(BankImportPreview)(plan.preview)),
      confirmedAt,
    ],
  );
  yield* sql.query(
    "insert bank source files",
    `INSERT INTO bank_source_files (
       id, bank_import_id, role, media_type, byte_digest, r2_key, original_name, byte_length
     )
     SELECT x.id::uuid, $1::uuid, x.role, x.media_type, x.byte_digest, x.r2_key,
            x.original_name, x.byte_length
       FROM jsonb_to_recordset($2::jsonb) AS x(
         id text, role text, media_type text, byte_digest text, r2_key text,
         original_name text, byte_length integer
       )`,
    [
      result.importId,
      json(
        plan.sourceFiles.map((file) => ({
          id: file.id,
          role: file.role,
          media_type: file.mediaType,
          byte_digest: file.byteDigest,
          r2_key: file.r2Key,
          original_name: file.originalName,
          byte_length: file.byteLength,
        })),
      ),
    ],
  );

  if (plan.transactions.length > 0) {
    yield* sql.query(
      "insert bank transactions",
      `INSERT INTO bank_transactions (
         id, bank_account_id, posted_date, amount, preferred_display_narrative,
         derived_payee, creation_import_id, created_at
       )
       SELECT x.id::uuid, $1::uuid, x.posted_date::date, x.amount::numeric,
              x.narrative, x.payee, $2::uuid, $3::timestamptz
         FROM jsonb_to_recordset($4::jsonb) AS x(
           id text, posted_date text, amount text, narrative text, payee text
         )`,
      [
        accountId,
        result.importId,
        confirmedAt,
        json(
          plan.transactions.map((transaction) => ({
            id: transaction.id,
            posted_date: transaction.postedDate,
            amount: money(transaction.amount),
            narrative: transaction.preferredNarrative,
            payee: transaction.payee,
          })),
        ),
      ],
    );
  }

  yield* sql.query(
    "insert bank observations",
    `INSERT INTO bank_observations (
       id, source_file_id, source_ordinal, source_kind, raw_fields, parsed_fields,
       posted_date, amount, row_balance, bank_identifier, narrative_fingerprint,
       equal_row_occurrence, parser_version, normalizer_version, parse_status
     )
     SELECT x.id::uuid, x.source_file_id::uuid, x.source_ordinal, x.source_kind,
            x.raw_fields, x.parsed_fields, x.posted_date::date, x.amount::numeric,
            x.row_balance::numeric, x.bank_identifier, x.narrative_fingerprint,
            x.equal_row_occurrence, $1, 'money-normalizer-v1', 'parsed'
       FROM jsonb_to_recordset($2::jsonb) AS x(
         id text, source_file_id text, source_ordinal integer, source_kind text,
         raw_fields jsonb, parsed_fields jsonb, posted_date text, amount text,
         row_balance text, bank_identifier text, narrative_fingerprint text,
         equal_row_occurrence integer
       )`,
    [
      plan.sourceProfile,
      json(
        plan.observations.map((observation) => ({
          id: observation.id,
          source_file_id: observation.sourceFileId,
          source_ordinal: observation.sourceOrdinal,
          source_kind: observation.sourceKind,
          raw_fields: observation.rawFields,
          parsed_fields: observation.parsedFields,
          posted_date: observation.postedDate,
          amount: money(observation.amount),
          row_balance: observation.rowBalance === null ? null : money(observation.rowBalance),
          bank_identifier: observation.bankIdentifier,
          narrative_fingerprint: observation.narrativeFingerprint,
          equal_row_occurrence: observation.equalRowOccurrence,
        })),
      ),
    ],
  );
  yield* sql.query(
    "insert bank observation links",
    `INSERT INTO bank_observation_links (
       observation_id, transaction_id, match_tier, provenance, linked_at
     )
     SELECT x.observation_id::uuid, x.transaction_id::uuid, x.match_tier,
            x.provenance, $1::timestamptz
       FROM jsonb_to_recordset($2::jsonb) AS x(
         observation_id text, transaction_id text, match_tier text, provenance jsonb
       )`,
    [
      confirmedAt,
      json(
        plan.observations.map((observation) => ({
          observation_id: observation.id,
          transaction_id: observation.transactionId,
          match_tier: observation.matchTier,
          provenance: observation.provenance,
        })),
      ),
    ],
  );
  yield* sql.query(
    "insert bank balance observations",
    `INSERT INTO bank_balance_observations (
       id, bank_account_id, kind, value, as_of_date,
       source_observation_id, source_file_id, recorded_at
     )
     SELECT x.id::uuid, $1::uuid, x.kind, x.value::numeric,
            x.as_of_date::date, x.source_observation_id::uuid, x.source_file_id::uuid,
            $2::timestamptz
       FROM jsonb_to_recordset($3::jsonb) AS x(
         id text, kind text, value text, as_of_date text,
         source_observation_id text, source_file_id text
       )`,
    [
      accountId,
      confirmedAt,
      json(
        plan.balances.map((balance) => ({
          id: balance.id,
          kind: balance.kind,
          value: money(balance.value),
          as_of_date: balance.asOfDate,
          source_observation_id: balance.sourceObservationId,
          source_file_id: balance.sourceFileId,
        })),
      ),
    ],
  );
  yield* sql.query(
    "insert bank coverage",
    `INSERT INTO bank_coverage_segments (
       id, bank_account_id, start_date, end_date, source_profile,
       bank_import_id, status, recorded_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'complete',$7)`,
    [
      plan.coverage.id,
      accountId,
      plan.coverage.start,
      plan.coverage.end,
      plan.sourceProfile,
      result.importId,
      confirmedAt,
    ],
  );
  yield* commitCoverageStatusesWith(sql, plan, confirmedAt);

  if (plan.classifications.length > 0) {
    yield* sql.query(
      "insert transaction classifications",
      `INSERT INTO transaction_classifications (
         id, transaction_id, provenance, source_id, source_version, expected_total, recorded_at
       )
       SELECT x.id::uuid, x.transaction_id::uuid, x.provenance, x.source_id::uuid,
              x.source_version, x.expected_total::numeric, $1::timestamptz
         FROM jsonb_to_recordset($2::jsonb) AS x(
           id text, transaction_id text, provenance text, source_id text,
           source_version integer, expected_total text
         )`,
      [
        confirmedAt,
        json(
          plan.classifications.map((classification) => ({
            id: classification.id,
            transaction_id: classification.transactionId,
            provenance: classification.provenance,
            source_id: classification.sourceId,
            source_version: classification.sourceVersion,
            expected_total: money(classification.amount),
          })),
        ),
      ],
    );
    yield* sql.query(
      "insert transaction splits",
      `INSERT INTO transaction_splits (id, classification_id, category_id, amount)
       SELECT x.id::uuid, x.classification_id::uuid, x.category_id::uuid, x.amount::numeric
         FROM jsonb_to_recordset($1::jsonb) AS x(
           id text, classification_id text, category_id text, amount text
         )`,
      [
        json(
          plan.classifications.map((classification) => ({
            id: classification.split.id,
            classification_id: classification.id,
            category_id: classification.split.categoryId,
            amount: money(classification.split.amount),
          })),
        ),
      ],
    );
  }

  if (plan.transfers.length > 0) {
    yield* sql.query(
      "insert transfer matches",
      `INSERT INTO transfer_matches (
         id, debit_transaction_id, credit_transaction_id, status, method, provenance, recorded_at
       )
       SELECT x.id::uuid, x.debit_id::uuid, x.credit_id::uuid, x.status, x.method,
              x.provenance, $1::timestamptz
         FROM jsonb_to_recordset($2::jsonb) AS x(
           id text, debit_id text, credit_id text, status text, method text, provenance jsonb
         )`,
      [
        confirmedAt,
        json(
          plan.transfers.map((transfer) => ({
            id: transfer.id,
            debit_id: transfer.debitTransactionId,
            credit_id: transfer.creditTransactionId,
            status: transfer.status,
            method: transfer.method,
            provenance: transfer.provenance,
          })),
        ),
      ],
    );
  }

  yield* sql.query(
    "insert bank import feed event",
    `INSERT INTO feed_events (
       id, occurred_at, origin, category, event_type, severity, summary, payload, links
     ) VALUES ($1,$2,'money','money','bank_import_completed','info',$3,$4::jsonb,$5::jsonb)`,
    [
      plan.feedEvent.id,
      confirmedAt,
      `Imported ${result.sourceTransactions} bank transactions`,
      json(plan.feedEvent.payload),
      json({ import: result.importId }),
    ],
  );
  yield* sql.query(
    "record bank import request",
    `INSERT INTO app_requests (request_id, operation, payload_hash, response, completed_at)
     VALUES ($1,'money.confirm_import',$2,$3::jsonb,$4)`,
    [
      plan.requestId,
      plan.requestPayloadHash,
      json(Schema.encodeSync(ConfirmedBankImport)(result)),
      confirmedAt,
    ],
  );

  return result;
});

const commitArchiveWith = Effect.fn("MoneyPostgresRepository.commitArchiveWith")(function* (
  sql: SqlExecutor,
  accountId: BankAccountId,
  plan: StatementArchivePlan,
) {
  const archivedAt = DateTime.toDateUtc(plan.result.archivedAt);
  yield* sql.query(
    "insert bank statement archive",
    `INSERT INTO bank_statement_archives (
       id, bank_account_id, byte_digest, r2_key, original_name, media_type,
       byte_length, archived_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      plan.result.id,
      accountId,
      plan.result.digest,
      plan.result.r2Key,
      plan.originalName,
      plan.mediaType,
      plan.byteLength,
      archivedAt,
    ],
  );
  yield* sql.query(
    "record statement archive request",
    `INSERT INTO app_requests (request_id, operation, payload_hash, response, completed_at)
     VALUES ($1,'money.archive_statement',$2,$3::jsonb,$4)`,
    [
      plan.requestId,
      plan.requestPayloadHash,
      json(Schema.encodeSync(ArchivedBankStatement)(plan.result)),
      archivedAt,
    ],
  );
  return plan.result;
});

export const postgresMoneyImportRepositoryLayer = (connectionString: string) =>
  Layer.succeed(
    MoneyImportRepository,
    MoneyImportRepository.of({
      listAccounts: withClient(connectionString, listAccountsWith),
      registerAccount: (input) =>
        inTransaction(connectionString, moneyRecordLock, (sql) => registerAccountWith(sql, input)),
      snapshot: (accountId) =>
        inReadTransaction(connectionString, (sql) => snapshotWith(sql, accountId, null)),
      withAccountTransaction: (accountId, requestId, use) =>
        inTransaction(connectionString, moneyRecordLock, (sql) => {
          const transaction: MoneyTransaction = {
            snapshot: snapshotWith(sql, accountId, requestId),
            commitImport: (plan) => commitImportWith(sql, accountId, plan),
            commitStatementArchive: (plan) => commitArchiveWith(sql, accountId, plan),
          };
          return use(transaction);
        }),
      importHistory: (accountId) =>
        withClient(connectionString, (sql) =>
          Effect.gen(function* () {
            const rows = yield* sql.query(
              "read import history",
              `SELECT id AS "importId",
                      bank_account_id AS "accountId",
                      profile_version AS "profile",
                      bundle_digest AS "bundleDigest",
                      source_start::text AS "windowStart",
                      source_end::text AS "windowEnd",
                      source_transactions AS "sourceTransactions",
                      observation_count AS "observations",
                      new_transactions AS "newTransactions",
                      duplicate_transactions AS "duplicates",
                      resolved_ambiguities AS "resolvedAmbiguities",
                      confirmed_at AS "confirmedAt"
                 FROM bank_imports
                WHERE ($1::uuid IS NULL OR bank_account_id = $1)
                ORDER BY confirmed_at DESC`,
              [accountId],
            );
            const HistoryRow = Schema.Struct({
              importId: BankImportId,
              accountId: BankAccountId,
              profile: Schema.String,
              bundleDigest: Sha256,
              windowStart: CalendarDate,
              windowEnd: CalendarDate,
              sourceTransactions: Schema.Int,
              observations: Schema.Int,
              newTransactions: Schema.Int,
              duplicates: Schema.Int,
              resolvedAmbiguities: Schema.Int,
              confirmedAt: Schema.DateTimeUtcFromDate,
            });
            const results = yield* decodeRows("decode import history records", HistoryRow, rows);
            return results.map(({ windowStart, windowEnd, ...result }): BankImportHistoryItem => ({
              ...result,
              window: { start: windowStart, end: windowEnd },
            }));
          }),
        ),
    }),
  );
