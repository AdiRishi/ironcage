import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "./postgres-test-database";

const database = usePostgresTestDatabase();

it.effect("builds the repository schema in an empty Postgres 18 database", () =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const tables = yield* postgres.query(
      "list migrated tables",
      `SELECT table_name AS "tableName"
         FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name`,
    );

    expect(tables).toEqual([
      { tableName: "acknowledgments" },
      { tableName: "app_requests" },
      { tableName: "bank_accounts" },
      { tableName: "bank_ambiguity_resolutions" },
      { tableName: "bank_balance_observations" },
      { tableName: "bank_coverage_segments" },
      { tableName: "bank_imports" },
      { tableName: "bank_observation_links" },
      { tableName: "bank_observations" },
      { tableName: "bank_source_files" },
      { tableName: "bank_source_identifiers" },
      { tableName: "bank_transactions" },
      { tableName: "capability_outputs" },
      { tableName: "categories" },
      { tableName: "categorization_rules" },
      { tableName: "categorization_suggestions" },
      { tableName: "decision_records" },
      { tableName: "feed_events" },
      { tableName: "queue_dedupe" },
      { tableName: "sleeve_transitions" },
      { tableName: "sleeves" },
      { tableName: "transaction_splits" },
      { tableName: "transfer_matches" },
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
