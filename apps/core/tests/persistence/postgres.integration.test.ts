import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "./postgres-test-database";

const database = usePostgresTestDatabase();

it.effect("applies every repository migration to an empty Postgres 18 database", () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const tables = yield* postgres.query(
      "list migrated tables",
      `SELECT table_name AS "tableName"
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );
    const ledger = yield* postgres.query(
      "read migration ledger",
      "SELECT id, name, outcome FROM schema_migrations ORDER BY id",
    );

    expect(tables).toEqual([
      { tableName: "app_requests" },
      { tableName: "schema_migrations" },
      { tableName: "sleeve_transitions" },
      { tableName: "sleeves" },
    ]);
    expect(ledger).toEqual([
      { id: 1, name: "sleeves", outcome: "applied" },
      { id: 2, name: "app_requests", outcome: "applied" },
    ]);
  }).pipe(Effect.provide(Postgres.layerForRequest(database.connectionString()))),
);

it.effect("rolls back a failed real PostgreSQL transaction", () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const error = yield* Effect.flip(
      postgres.transaction((sql) =>
        sql
          .query(
            "insert app request",
            `INSERT INTO app_requests
               (request_id, operation, payload_hash, response, completed_at)
             VALUES ($1, $2, $3, $4::jsonb, now())`,
            [
              "018f6b2a-7c4e-7d31-a2f0-3b9d4e8c1a55",
              "sleeve.pause",
              "a".repeat(64),
              JSON.stringify({ accepted: true }),
            ],
          )
          .pipe(Effect.andThen(Effect.fail("abort"))),
      ),
    );
    const rows = yield* postgres.query(
      "count app requests",
      "SELECT count(*)::integer AS count FROM app_requests",
    );

    expect(error).toBe("abort");
    expect(rows).toEqual([{ count: 0 }]);
  }).pipe(Effect.provide(Postgres.layerForRequest(database.connectionString()))),
);
