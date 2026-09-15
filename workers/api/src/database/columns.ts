import type { SqlClient, Statement } from "effect/unstable/sql";

export const instant = (
  sql: SqlClient.SqlClient,
  column: Statement.Fragment | Statement.Identifier,
) => sql`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export const money = (sql: SqlClient.SqlClient, currency: string, minor: string) =>
  sql`jsonb_build_object('currency', ${sql(currency)}, 'minor', ${sql(minor)}::text)`;

export const nullableMoney = (sql: SqlClient.SqlClient, currency: string, minor: string) =>
  sql`CASE WHEN ${sql(minor)} IS NULL THEN NULL ELSE ${money(sql, currency, minor)} END`;

export const postingFields = (
  sql: SqlClient.SqlClient,
) => sql`p.id, p.account_id AS "accountId", a.label AS "accountLabel", p.posted_on::text AS "postedOn", p.value_on::text AS "valueOn", p.description,
  ${money(sql, "p.currency", "p.amount_minor")} AS amount,
  ${nullableMoney(sql, "p.original_currency", "p.original_amount_minor")} AS "originalMoney"`;

export const accountFields = (sql: SqlClient.SqlClient) =>
  sql`id, kind, label, currency, bank_id AS "bankId", account_number AS "accountNumber", version`;
