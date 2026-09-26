import type { PgClient } from "@effect/sql-pg";
import { SourceFileId } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

import { instant } from "../database/columns.ts";
import { readTransaction } from "../database/transactions.ts";

const Column = Schema.Struct({ table: Schema.String, name: Schema.String, type: Schema.String });
const TableData = Schema.Struct({ json: Schema.String, count: Schema.Int });
const Source = Schema.Struct({
  id: SourceFileId,
  fileName: Schema.String,
  objectKey: Schema.String,
  bytesAvailable: Schema.Boolean,
});

export const takeSnapshot = Effect.fn("Exports.snapshot")(function* (sql: PgClient.PgClient) {
  return yield* readTransaction(
    sql,
    Effect.gen(function* () {
      const times =
        yield* sql`SELECT ${instant(sql, sql`transaction_timestamp()`)} AS instant`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ instant: Schema.String })])),
          ),
        );
      const columns =
        yield* sql`SELECT c.table_name AS "table", c.column_name AS name, c.data_type AS type FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' ORDER BY c.table_name, c.ordinal_position`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Column))),
        );
      const tables = yield* Effect.forEach(
        [...new Set(columns.map((column) => column.table))],
        (name) =>
          Effect.gen(function* () {
            const fields = columns
              .filter((column) => column.table === name)
              .map((column) => {
                const field = sql(column.name);
                const value =
                  column.type === "bigint" || column.type === "numeric"
                    ? sql`${field}::text`
                    : column.type === "date"
                      ? sql`to_char(${field}, 'YYYY-MM-DD')`
                      : column.type === "timestamp with time zone"
                        ? instant(sql, field)
                        : field;
                return sql`${value} AS ${field}`;
              });
            const rows =
              yield* sql`SELECT COALESCE(json_agg(record), '[]'::json)::text AS json, count(*)::integer AS count FROM (SELECT ${sql.csv(fields)} FROM ${sql(name)}) record`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([TableData]))),
              );
            const row = rows[0];
            return { name, path: `tables/${name}.json`, count: row.count, json: row.json };
          }),
      );
      const sources =
        yield* sql`SELECT id, file_name AS "fileName", object_key AS "objectKey", bytes_available AS "bytesAvailable" FROM source_files ORDER BY id`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Source))),
        );
      return { snapshotAt: times[0].instant, tables, sources };
    }),
  );
});
