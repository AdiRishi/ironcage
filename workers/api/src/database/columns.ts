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
) => sql`p.id, p.account_id AS "accountId", COALESCE((SELECT h.label FROM account_periods h WHERE h.account_id=p.account_id AND p.posted_on >= h.start_on AND (h.end_on IS NULL OR p.posted_on<h.end_on)), a.label) AS "accountLabel", p.posted_on::text AS "postedOn", p.value_on::text AS "valueOn", p.description,
  ${money(sql, "p.currency", "p.amount_minor")} AS amount,
  ${nullableMoney(sql, "p.original_currency", "p.original_amount_minor")} AS "originalMoney"`;

// The date an event from `events e` with primary posting `postings p` counts on, as ledger
// facts place it: a purchase's purchase date when it has one, else the posted date.
export const spendingDate = (sql: SqlClient.SqlClient) =>
  sql`CASE WHEN e.kind = 'purchase' AND e.purchase_on IS NOT NULL THEN e.purchase_on ELSE p.posted_on END`;

// A counterparty's own fields from `counterparties c`, as `CounterpartyRecord` reads them.
export const counterpartyRecordColumns = (sql: SqlClient.SqlClient) =>
  sql`c.id, c.name, c.kind, c.brand, c.default_category_id AS "defaultCategoryId", c.default_role AS "defaultRole",
    c.source, c.status, c.model, c.confidence::float8 AS confidence, c.reason, c.version`;

// A counterparty from `counterparties c`, as `Counterparty` reads it.
export const counterpartyColumns = (sql: SqlClient.SqlClient) =>
  sql`${counterpartyRecordColumns(sql)}, ${instant(sql, sql("c.updated_at"))} AS "updatedAt"`;

export const accountFields = (sql: SqlClient.SqlClient) =>
  sql`id, kind, institution, label, currency, bank_id AS "bankId", account_number AS "accountNumber", version`;

// Whether `column` contains `text`, ignoring case. The wildcards `%` and `_` in the text
// match only themselves. A trigram index on the column serves the match.
export const containsText = (
  sql: SqlClient.SqlClient,
  column: Statement.Fragment | Statement.Identifier,
  text: string,
) => sql`${column} ILIKE ${`%${text.replaceAll(/[\\%_]/g, (character) => `\\${character}`)}%`}`;
