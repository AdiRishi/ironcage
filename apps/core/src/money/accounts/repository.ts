import { BankAccountId, BankAccountType, CalendarDate } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { decodeRows, type PersistenceError, type SqlExecutor } from "../../persistence";

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
