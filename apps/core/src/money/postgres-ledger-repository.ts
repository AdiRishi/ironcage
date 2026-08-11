import {
  AccountBalance,
  BankAccountId,
  BankImportId,
  BankObservationId,
  BankSourceFileId,
  BankTransactionId,
  BankTransactionRecord,
  CalendarDate,
  Category,
  CategoryId,
  CategorizationReviewItem,
  CategorizationRule,
  CategorizationSuggestionId,
  CategorizationRulePredicate,
  CategorySplit,
  DecisionRecordId,
  formatMoney,
  Money,
  MonthlySpendingReport,
  RequestId,
  Sha256,
  TransferCandidate,
  uncategorizedCategoryId,
} from "@ironcage/domain";
import { DateTime, Effect, Layer, Schema } from "effect";

import { PersistenceError } from "../persistence";
import type { AnalysisTransaction } from "./analysis";
import {
  type CategorizePlan,
  type CreateCategoryPlan,
  type EditRulePlan,
  type MarkReportReadPlan,
  type MoneyLedgerSnapshot,
  MoneyLedgerRepository,
  type MoneyLedgerTransaction,
  type RenameCategoryPlan,
  type ResolveTransferPlan,
  type SaveReportPlan,
} from "./ledger-repository";
import {
  decodeRows,
  inReadTransaction,
  inTransaction,
  moneyRecordLock,
  type SqlExecutor,
} from "./postgres";
import { listAccountsWith } from "./postgres-repository";

const json = (value: unknown) => JSON.stringify(value);

const TransactionRow = Schema.Struct({
  id: BankTransactionId,
  accountId: BankAccountId,
  postedDate: CalendarDate,
  amount: Money,
  narrative: Schema.String,
  payee: Schema.String,
  ownedTransfer: Schema.Boolean,
  categoryId: CategoryId,
  categoryName: Schema.String,
  categoryKind: Schema.Literals(["expense", "income"]),
  splitAmount: Money,
});

const SuggestionRow = Schema.Struct({
  id: CategorizationSuggestionId,
  transactionId: BankTransactionId,
  splits: Schema.Array(CategorySplit),
  confidence: Schema.BigDecimalFromString,
  rationale: Schema.String,
  decisionRecordId: DecisionRecordId,
});

const SplitRow = Schema.Struct({
  id: BankTransactionId,
  accountId: BankAccountId,
  postedDate: CalendarDate,
  amount: Money,
  preferredNarrative: Schema.String,
  ownedTransfer: Schema.Boolean,
  categoryId: CategoryId,
  splitAmount: Money,
});

const ObservationRow = Schema.Struct({
  transactionId: BankTransactionId,
  id: BankObservationId,
  sourceFileId: BankSourceFileId,
  importId: BankImportId,
  sourceRole: Schema.Literals(["csv", "ofx", "pdf", "extracted_markdown"]),
  originalName: Schema.String,
  sourceKind: Schema.Literals(["csv", "ofx", "statement"]),
  sourceOrdinal: Schema.Int,
  rawFields: Schema.Record(Schema.String, Schema.String),
  parsedFields: Schema.Record(Schema.String, Schema.String),
  matchTier: Schema.Literals([
    "new",
    "bank_identifier",
    "row_balance",
    "content_occurrence",
    "manual",
  ]),
});

const snapshotWith = Effect.fn("MoneyPostgresLedgerRepository.snapshotWith")(function* (
  sql: SqlExecutor,
  requestId: RequestId | null,
): Effect.fn.Return<MoneyLedgerSnapshot, PersistenceError> {
  const accounts = yield* listAccountsWith(sql);
  const coverageRows = yield* sql.query(
    "read money coverage",
    `SELECT bank_account_id AS "accountId",
            start_date::text AS "start",
            end_date::text AS "end"
       FROM bank_coverage_segments
      WHERE status = 'complete'
      ORDER BY bank_account_id, start_date, end_date`,
  );
  const coverage = yield* decodeRows(
    "decode money coverage",
    Schema.Struct({ accountId: BankAccountId, start: CalendarDate, end: CalendarDate }),
    coverageRows,
  );
  const categoryRows = yield* sql.query(
    "read money categories",
    `SELECT DISTINCT ON (c.id)
            c.id,
            v.version,
            v.name,
            c.kind,
            c.system
       FROM money_categories c
       JOIN money_category_versions v ON v.category_id = c.id
      ORDER BY c.id, v.version DESC`,
  );
  const categories = yield* decodeRows("decode money categories", Category, categoryRows);
  const ruleRows = yield* sql.query(
    "read categorization rules",
    `SELECT DISTINCT ON (id)
            id,
            version,
            name,
            predicate,
            category_id AS "categoryId",
            effective_from::text AS "effectiveFrom",
            CASE WHEN retired_at IS NULL THEN NULL
                 ELSE to_char(retired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             END AS "retiredAt"
       FROM categorization_rules
      ORDER BY id, version DESC`,
  );
  const rules = yield* decodeRows("decode categorization rules", CategorizationRule, ruleRows);
  const transactionRows = yield* sql.query(
    "read categorized bank transactions",
    `WITH effective_classifications AS (
       SELECT DISTINCT ON (transaction_id)
              id, transaction_id
         FROM transaction_classifications
        ORDER BY transaction_id, recorded_at DESC, id DESC
     ), category_names AS (
       SELECT DISTINCT ON (category_id)
              category_id, name
         FROM money_category_versions
        ORDER BY category_id, version DESC
     )
     SELECT t.id,
            t.bank_account_id AS "accountId",
            t.posted_date::text AS "postedDate",
            t.amount::text AS "amount",
            t.preferred_display_narrative AS "narrative",
            t.derived_payee AS "payee",
            EXISTS (
              SELECT 1 FROM transfer_matches tm
               WHERE tm.status = 'confirmed'
                 AND (tm.debit_transaction_id = t.id OR tm.credit_transaction_id = t.id)
            ) AS "ownedTransfer",
            s.category_id AS "categoryId",
            cn.name AS "categoryName",
            c.kind AS "categoryKind",
            s.amount::text AS "splitAmount"
       FROM bank_transactions t
       JOIN effective_classifications ec ON ec.transaction_id = t.id
       JOIN transaction_splits s ON s.classification_id = ec.id
       JOIN money_categories c ON c.id = s.category_id
       JOIN category_names cn ON cn.category_id = c.id
      ORDER BY t.id, s.id`,
  );
  const decodedTransactions = yield* decodeRows(
    "decode categorized bank transactions",
    TransactionRow,
    transactionRows,
  );
  const transactionMap = new Map<BankTransactionId, AnalysisTransaction>();
  for (const row of decodedTransactions) {
    const split = {
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      categoryKind: row.categoryKind,
      amount: row.splitAmount,
    };
    const current = transactionMap.get(row.id);
    if (current === undefined) {
      transactionMap.set(row.id, {
        id: row.id,
        accountId: row.accountId,
        postedDate: row.postedDate,
        amount: row.amount,
        payee: row.payee,
        narrative: row.narrative,
        ownedTransfer: row.ownedTransfer,
        splits: [split],
      });
    } else {
      transactionMap.set(row.id, { ...current, splits: [...current.splits, split] });
    }
  }
  const transactions = [...transactionMap.values()];
  const suggestionRows = yield* sql.query(
    "read categorization suggestions",
    `SELECT DISTINCT ON (transaction_id)
            id,
            transaction_id AS "transactionId",
            splits,
            confidence::text AS "confidence",
            rationale,
            decision_record_id AS "decisionRecordId"
       FROM categorization_suggestions
      WHERE status = 'pending'
      ORDER BY transaction_id, created_at DESC, id DESC`,
  );
  const suggestions = yield* decodeRows(
    "decode categorization suggestions",
    SuggestionRow,
    suggestionRows,
  );
  const review: CategorizationReviewItem[] = transactions
    .filter((transaction) =>
      transaction.splits.some((split) => split.categoryId === uncategorizedCategoryId),
    )
    .map((transaction) => ({
      transactionId: transaction.id,
      accountId: transaction.accountId,
      postedDate: transaction.postedDate,
      amount: transaction.amount,
      narrative: transaction.narrative,
      splits: transaction.splits.map((split) => ({
        categoryId: split.categoryId,
        amount: split.amount,
      })),
      suggestion:
        suggestions.find((suggestion) => suggestion.transactionId === transaction.id) ?? null,
    }));
  const transferRows = yield* sql.query(
    "read transfer review",
    `SELECT tm.id,
            tm.debit_transaction_id AS "debitTransactionId",
            tm.credit_transaction_id AS "creditTransactionId",
            abs(debit.amount)::text AS amount,
            debit.posted_date::text AS "debitDate",
            credit.posted_date::text AS "creditDate",
            tm.method,
            tm.status
       FROM transfer_matches tm
       JOIN bank_transactions debit ON debit.id = tm.debit_transaction_id
       JOIN bank_transactions credit ON credit.id = tm.credit_transaction_id
      WHERE tm.status = 'proposed'
      ORDER BY debit.posted_date, tm.id`,
  );
  const transfers = yield* decodeRows("decode transfer review", TransferCandidate, transferRows);
  const confirmedTransferRows = yield* sql.query(
    "read confirmed owned transfers",
    `SELECT debit_transaction_id AS id FROM transfer_matches WHERE status = 'confirmed'
     UNION
     SELECT credit_transaction_id AS id FROM transfer_matches WHERE status = 'confirmed'`,
  );
  const confirmedTransferTransactionIds = yield* decodeRows(
    "decode confirmed owned transfers",
    Schema.Struct({ id: BankTransactionId }),
    confirmedTransferRows,
  ).pipe(Effect.map((rows) => rows.map((row) => row.id)));
  const balanceRows = yield* sql.query(
    "read latest account balances",
    `SELECT DISTINCT ON (b.bank_account_id, b.kind)
            b.bank_account_id AS "accountId",
            a.product_label AS "label",
            b.kind,
            b.value::text AS amount,
            b.as_of_date::text AS "asOfDate"
       FROM bank_balance_observations b
       JOIN bank_accounts a ON a.id = b.bank_account_id
      WHERE b.kind IN ('ledger','available')
      ORDER BY b.bank_account_id, b.kind, b.as_of_date DESC, b.recorded_at DESC, b.id DESC`,
  );
  const balances = yield* decodeRows("decode account balances", AccountBalance, balanceRows);
  const reportRows = yield* sql.query(
    "read monthly spending reports",
    `SELECT id,
            report_month AS month,
            to_char(generated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "generatedAt",
            CASE WHEN read_at IS NULL THEN NULL
                 ELSE to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             END AS "readAt",
            data_through::text AS "dataThrough",
            analysis,
            recurring_charges AS "recurringCharges",
            anomalies,
            suggestions,
            supporting_transaction_ids AS "supportingTransactionIds",
            body_key AS "bodyKey"
       FROM monthly_spending_reports
      ORDER BY report_month DESC`,
  );
  const reports = yield* decodeRows(
    "decode monthly spending reports",
    MonthlySpendingReport,
    reportRows,
  );
  const requestRows =
    requestId === null
      ? []
      : yield* sql.query(
          "read money ledger request",
          `SELECT request_id AS "requestId", operation, payload_hash AS "payloadHash", response
             FROM app_requests
            WHERE request_id = $1`,
          [requestId],
        );
  const requests = yield* decodeRows(
    "decode money ledger requests",
    Schema.Struct({
      requestId: RequestId,
      operation: Schema.String,
      payloadHash: Sha256,
      response: Schema.Unknown,
    }),
    requestRows,
  );

  return {
    analysis: { accounts, coverage, transactions },
    categories,
    rules,
    review,
    transfers,
    confirmedTransferTransactionIds,
    balances,
    reports,
    requests,
  };
});

const transactionsWith = Effect.fn("MoneyPostgresLedgerRepository.transactionsWith")(function* (
  sql: SqlExecutor,
  ids: readonly BankTransactionId[],
) {
  const splitRows = yield* sql.query(
    "read bank transaction records",
    `WITH effective_classifications AS (
       SELECT DISTINCT ON (transaction_id) id, transaction_id
         FROM transaction_classifications
        WHERE transaction_id = ANY($1::uuid[])
        ORDER BY transaction_id, recorded_at DESC, id DESC
     )
     SELECT t.id,
            t.bank_account_id AS "accountId",
            t.posted_date::text AS "postedDate",
            t.amount::text AS amount,
            t.preferred_display_narrative AS "preferredNarrative",
            EXISTS (
              SELECT 1 FROM transfer_matches tm
               WHERE tm.status = 'confirmed'
                 AND (tm.debit_transaction_id = t.id OR tm.credit_transaction_id = t.id)
            ) AS "ownedTransfer",
            s.category_id AS "categoryId",
            s.amount::text AS "splitAmount"
       FROM bank_transactions t
       JOIN effective_classifications ec ON ec.transaction_id = t.id
       JOIN transaction_splits s ON s.classification_id = ec.id
      ORDER BY t.id, s.id`,
    [ids],
  );
  const splits = yield* decodeRows("decode bank transaction records", SplitRow, splitRows);
  const records = new Map<BankTransactionId, Omit<BankTransactionRecord, "observations">>();
  for (const row of splits) {
    const split = { categoryId: row.categoryId, amount: row.splitAmount };
    const current = records.get(row.id);
    records.set(
      row.id,
      current === undefined
        ? {
            id: row.id,
            accountId: row.accountId,
            postedDate: row.postedDate,
            amount: row.amount,
            preferredNarrative: row.preferredNarrative,
            ownedTransfer: row.ownedTransfer,
            splits: [split],
          }
        : { ...current, splits: [...current.splits, split] },
    );
  }

  const observationRows = yield* sql.query(
    "read bank transaction observations",
    `SELECT o.id,
            o.source_file_id AS "sourceFileId",
            f.bank_import_id AS "importId",
            f.role AS "sourceRole",
            f.original_name AS "originalName",
            o.source_kind AS "sourceKind",
            o.source_ordinal AS "sourceOrdinal",
            o.raw_fields AS "rawFields",
            o.parsed_fields AS "parsedFields",
            l.match_tier AS "matchTier",
            l.transaction_id AS "transactionId"
       FROM bank_observation_links l
       JOIN bank_observations o ON o.id = l.observation_id
       JOIN bank_source_files f ON f.id = o.source_file_id
      WHERE l.transaction_id = ANY($1::uuid[])
      ORDER BY l.transaction_id, f.role, o.source_ordinal, o.id`,
    [ids],
  );
  const observations = yield* decodeRows(
    "decode bank transaction observations",
    ObservationRow,
    observationRows,
  );

  return ids.flatMap((id): readonly BankTransactionRecord[] => {
    const record = records.get(id);
    return record === undefined
      ? []
      : [
          {
            ...record,
            observations: observations
              .filter((observation) => observation.transactionId === id)
              .map(({ transactionId: _, ...observation }) => observation),
          },
        ];
  });
});

const recordRequest = (
  sql: SqlExecutor,
  operation: string,
  requestId: RequestId,
  payloadHash: Sha256,
  response: unknown,
) =>
  sql.query(
    `record ${operation} request`,
    `INSERT INTO app_requests (request_id, operation, payload_hash, response, completed_at)
     VALUES ($1,$2,$3,$4::jsonb,now())`,
    [requestId, operation, payloadHash, json(response)],
  );

const createCategoryWith = Effect.fn("MoneyPostgresLedgerRepository.createCategoryWith")(function* (
  sql: SqlExecutor,
  plan: CreateCategoryPlan,
) {
  yield* sql.query(
    "insert money category",
    `INSERT INTO money_categories (id, kind, system, created_at)
       VALUES ($1,$2,false,now())`,
    [plan.response.id, plan.response.kind],
  );
  yield* sql.query(
    "insert money category version",
    `INSERT INTO money_category_versions (category_id, version, name, recorded_at)
       VALUES ($1,1,$2,now())`,
    [plan.response.id, plan.response.name],
  );
  yield* recordRequest(
    sql,
    "money.create_category",
    plan.requestId,
    plan.payloadHash,
    Schema.encodeSync(Category)(plan.response),
  );
  return plan.response;
});

const renameCategoryWith = Effect.fn("MoneyPostgresLedgerRepository.renameCategoryWith")(function* (
  sql: SqlExecutor,
  plan: RenameCategoryPlan,
) {
  yield* sql.query(
    "insert money category rename",
    `INSERT INTO money_category_versions (category_id, version, name, recorded_at)
       VALUES ($1,$2,$3,now())`,
    [plan.response.id, plan.response.version, plan.response.name],
  );
  yield* recordRequest(
    sql,
    "money.rename_category",
    plan.requestId,
    plan.payloadHash,
    Schema.encodeSync(Category)(plan.response),
  );
  return plan.response;
});

const categorizeWith = Effect.fn("MoneyPostgresLedgerRepository.categorizeWith")(function* (
  sql: SqlExecutor,
  plan: CategorizePlan,
) {
  const recordedAt = DateTime.toDateUtc(plan.recordedAt);
  yield* sql.query(
    "insert transaction classifications",
    `INSERT INTO transaction_classifications (
       id, transaction_id, provenance, source_id, source_version, expected_total, recorded_at
     )
     SELECT x.id::uuid, x.transaction_id::uuid, x.provenance, x.source_id::uuid,
            x.source_version, x.expected_total::numeric, $1
       FROM jsonb_to_recordset($2::jsonb) AS x(
         id text, transaction_id text, provenance text, source_id text,
         source_version integer, expected_total text
       )`,
    [
      recordedAt,
      json(
        plan.classifications.map((classification) => ({
          id: classification.id,
          transaction_id: classification.transactionId,
          provenance: classification.provenance,
          source_id: classification.sourceId,
          source_version: classification.sourceVersion,
          expected_total: formatMoney(classification.amount),
        })),
      ),
    ],
  );
  yield* sql.query(
    "insert categorized transaction splits",
    `INSERT INTO transaction_splits (id, classification_id, category_id, amount)
     SELECT x.id::uuid, x.classification_id::uuid, x.category_id::uuid, x.amount::numeric
       FROM jsonb_to_recordset($1::jsonb) AS x(
         id text, classification_id text, category_id text, amount text
       )`,
    [
      json(
        plan.classifications.flatMap((classification) =>
          classification.splits.map((split) => ({
            id: split.id,
            classification_id: classification.id,
            category_id: split.categoryId,
            amount: formatMoney(split.amount),
          })),
        ),
      ),
    ],
  );
  for (const classification of plan.classifications) {
    yield* sql.query(
      "resolve categorization suggestions",
      `UPDATE categorization_suggestions
          SET status = CASE WHEN id = $2::uuid THEN 'accepted' ELSE 'rejected' END,
              resolved_at = $3
        WHERE transaction_id = $1
          AND status = 'pending'`,
      [classification.transactionId, classification.acceptedSuggestionId, recordedAt],
    );
  }
  yield* recordRequest(
    sql,
    "money.categorize_transactions",
    plan.requestId,
    plan.payloadHash,
    plan.response,
  );
  return plan.response;
});

const editRuleWith = Effect.fn("MoneyPostgresLedgerRepository.editRuleWith")(function* (
  sql: SqlExecutor,
  plan: EditRulePlan,
) {
  const rule = plan.response;
  yield* sql.query(
    "insert categorization rule version",
    `INSERT INTO categorization_rules (
       id, version, name, predicate, category_id, effective_from, retired_at, recorded_at
     ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,now())`,
    [
      rule.id,
      rule.version,
      rule.name,
      json(Schema.encodeSync(CategorizationRulePredicate)(rule.predicate)),
      rule.categoryId,
      rule.effectiveFrom,
      rule.retiredAt === null ? null : DateTime.toDateUtc(rule.retiredAt),
    ],
  );
  yield* recordRequest(
    sql,
    "money.edit_categorization_rule",
    plan.requestId,
    plan.payloadHash,
    Schema.encodeSync(CategorizationRule)(rule),
  );
  return rule;
});

const resolveTransferWith = Effect.fn("MoneyPostgresLedgerRepository.resolveTransferWith")(
  function* (sql: SqlExecutor, plan: ResolveTransferPlan) {
    if (plan.decision === "confirmed") {
      yield* sql.query(
        "confirm owned transfer and reject alternatives",
        `WITH selected AS (
           SELECT debit_transaction_id, credit_transaction_id
             FROM transfer_matches
            WHERE id = $1 AND status = 'proposed'
         )
         UPDATE transfer_matches candidate
            SET status = CASE WHEN candidate.id = $1 THEN 'confirmed' ELSE 'rejected' END
           FROM selected
          WHERE candidate.status = 'proposed'
            AND (
              candidate.id = $1 OR
              candidate.debit_transaction_id IN (
                selected.debit_transaction_id, selected.credit_transaction_id
              ) OR
              candidate.credit_transaction_id IN (
                selected.debit_transaction_id, selected.credit_transaction_id
              )
            )`,
        [plan.transferId],
      );
    } else {
      yield* sql.query(
        "reject owned transfer",
        `UPDATE transfer_matches SET status = 'rejected' WHERE id = $1 AND status = 'proposed'`,
        [plan.transferId],
      );
    }
    yield* recordRequest(
      sql,
      "money.resolve_transfer",
      plan.requestId,
      plan.payloadHash,
      plan.response,
    );
    return plan.response;
  },
);

const saveReportWith = Effect.fn("MoneyPostgresLedgerRepository.saveReportWith")(function* (
  sql: SqlExecutor,
  plan: SaveReportPlan,
) {
  const report = plan.response;
  const encoded = Schema.encodeSync(MonthlySpendingReport)(report);
  const generatedAt = DateTime.toDateUtc(report.generatedAt);
  yield* sql.query(
    "insert monthly spending report",
    `INSERT INTO monthly_spending_reports (
       id, report_month, generated_at, data_through, analysis, recurring_charges,
       anomalies, suggestions, supporting_transaction_ids, body_key
     ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)`,
    [
      report.id,
      report.month,
      generatedAt,
      report.dataThrough,
      json(encoded.analysis),
      json(encoded.recurringCharges),
      json(encoded.anomalies),
      json(encoded.suggestions),
      report.supportingTransactionIds,
      report.bodyKey,
    ],
  );
  yield* sql.query(
    "insert report feed event",
    `INSERT INTO feed_events (
       id, occurred_at, origin, category, event_type, severity, summary, payload, links
     ) VALUES ($1,$2,'money','system','report_generated','info',$3,$4::jsonb,$5::jsonb)`,
    [
      plan.feedEventId,
      generatedAt,
      `Generated spending report for ${report.month}`,
      json({ month: report.month }),
      json({ report: report.id }),
    ],
  );
  for (const event of plan.analysisEvents) {
    const inserted = yield* sql.query(
      "claim money analysis event",
      `INSERT INTO money_analysis_events (rule, subject, calendar_month, feed_event_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT DO NOTHING
       RETURNING feed_event_id AS id`,
      [event.identity.rule, event.identity.subject, event.identity.month, event.id],
    );
    if (inserted.length === 0) continue;
    yield* sql.query(
      "insert money analysis feed event",
      `INSERT INTO feed_events (
         id, occurred_at, origin, category, event_type, severity, summary, payload
       ) VALUES ($1,$2,'money','money',$3,$4,$5,$6::jsonb)`,
      [event.id, generatedAt, event.eventType, event.severity, event.summary, json(event.payload)],
    );
  }
  yield* recordRequest(
    sql,
    "money.generate_monthly_report",
    plan.requestId,
    plan.payloadHash,
    encoded,
  );
  return report;
});

const markReportReadWith = Effect.fn("MoneyPostgresLedgerRepository.markReportReadWith")(function* (
  sql: SqlExecutor,
  plan: MarkReportReadPlan,
) {
  yield* sql.query(
    "mark monthly spending report read",
    `UPDATE monthly_spending_reports
          SET read_at = $2
        WHERE id = $1 AND read_at IS NULL`,
    [plan.response.id, DateTime.toDateUtc(plan.readAt)],
  );
  yield* recordRequest(
    sql,
    "money.mark_monthly_report_read",
    plan.requestId,
    plan.payloadHash,
    Schema.encodeSync(MonthlySpendingReport)(plan.response),
  );
  return plan.response;
});

export const postgresMoneyLedgerRepositoryLayer = (connectionString: string) =>
  Layer.succeed(
    MoneyLedgerRepository,
    MoneyLedgerRepository.of({
      snapshot: inReadTransaction(connectionString, (sql) => snapshotWith(sql, null)),
      transactions: (ids) =>
        inReadTransaction(connectionString, (sql) => transactionsWith(sql, ids)),
      withTransaction: (requestId, use) =>
        inTransaction(connectionString, moneyRecordLock, (sql) => {
          const transaction: MoneyLedgerTransaction = {
            snapshot: snapshotWith(sql, requestId),
            createCategory: (plan) => createCategoryWith(sql, plan),
            renameCategory: (plan) => renameCategoryWith(sql, plan),
            categorize: (plan) => categorizeWith(sql, plan),
            editRule: (plan) => editRuleWith(sql, plan),
            resolveTransfer: (plan) => resolveTransferWith(sql, plan),
            saveReport: (plan) => saveReportWith(sql, plan),
            markReportRead: (plan) => markReportReadWith(sql, plan),
          };
          return use(transaction);
        }),
    }),
  );
