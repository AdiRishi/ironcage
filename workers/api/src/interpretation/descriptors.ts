import type { SqlClient, Statement } from "effect/unstable/sql";

// Up to three texts the bank printed for an alias key, most frequent first.
export const descriptorSamples = (
  sql: SqlClient.SqlClient,
  aliasKey: Statement.Fragment | Statement.Identifier,
) =>
  sql`ARRAY(SELECT s.text FROM (SELECT sd.counterparty_text AS text, count(*) AS n FROM posting_descriptors sd
    WHERE sd.alias_key = ${aliasKey} AND sd.counterparty_text IS NOT NULL GROUP BY 1 ORDER BY n DESC, 1 LIMIT 3) s)`;

// The active transactions whose primary posting the bank wrote with an alias key.
export const aliasEventCount = (
  sql: SqlClient.SqlClient,
  aliasKey: Statement.Fragment | Statement.Identifier,
) =>
  sql`(SELECT count(*) FROM events ce JOIN posting_descriptors cd ON cd.posting_id = ce.primary_posting_id
    WHERE ce.active AND cd.alias_key = ${aliasKey})::int`;
