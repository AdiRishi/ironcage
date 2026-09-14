import type { SqlClient } from "effect/unstable/sql";

export const postingFields = (
  sql: SqlClient.SqlClient,
) => sql`p.id, p.account_id AS "accountId", a.label AS "accountLabel", p.posted_on::text AS "postedOn", p.value_on::text AS "valueOn", p.description,
  jsonb_build_object('currency', p.currency, 'minor', p.amount_minor::text) AS amount,
  CASE WHEN p.original_currency IS NULL THEN NULL ELSE jsonb_build_object('currency', p.original_currency, 'minor', p.original_amount_minor::text) END AS "originalMoney"`;
