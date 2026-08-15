import {
  BankAccountId,
  BankTransactionId,
  CalendarDate,
  CategoryId,
  CategoryKind,
} from "@ironcage/domain";
import { Schema } from "effect";

import type { SqlExecutor } from "../../persistence/postgres";

const SplitLineRow = Schema.Struct({
  transactionId: BankTransactionId,
  accountId: BankAccountId,
  postedDate: CalendarDate,
  payee: Schema.String,
  categoryId: CategoryId,
  categoryName: Schema.String,
  kind: CategoryKind,
  amount: Schema.BigDecimalFromString,
});

export const loadSplitLines = (sql: SqlExecutor) =>
  sql.rows(
    "load analysis split lines",
    SplitLineRow,
    `SELECT t.id AS "transactionId", t.account_id AS "accountId", t.posted_date AS "postedDate",
            t.derived_payee AS payee, s.category_id AS "categoryId", c.name AS "categoryName",
            c.kind, s.amount::text AS amount
       FROM bank_transactions t
       JOIN transaction_splits s
         ON s.transaction_id = t.id
        AND s.revision = (SELECT max(revision) FROM transaction_splits latest
                           WHERE latest.transaction_id = t.id)
       JOIN categories c ON c.id = s.category_id
      WHERE NOT EXISTS (SELECT 1 FROM transfer_matches m
                         WHERE m.status = 'confirmed'
                           AND (m.transaction_a = t.id OR m.transaction_b = t.id))
      ORDER BY t.posted_date, t.id`,
  );
