import type { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";

// Every write to financial records runs through here, one at a time.
export const writeTransaction = <A, E, R>(sql: PgClient.PgClient, effect: Effect.Effect<A, E, R>) =>
  sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`SELECT pg_advisory_xact_lock(1)`;
      return yield* effect;
    }),
  );
