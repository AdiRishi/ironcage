import { PgClient } from "@effect/sql-pg";
import { Effect, Schedule, Schema } from "effect";
import { SqlError } from "effect/unstable/sql";

import { refreshNotedFacts } from "../analysis/facts.ts";

// Every write to financial records runs here. Serializable isolation lets writes that
// touch different records run at once, and Postgres aborts one of two writes that
// would not have given the same result one after the other. The aborted one runs again
// from the start, so `effect` must not act outside the database. Facts for the events
// the transaction changed are refreshed before it commits. Nested inside another write,
// it joins that transaction.
export const writeTransaction = <A, E, R>(sql: PgClient.PgClient, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    if ((yield* Effect.serviceOption(sql.transactionService))._tag === "Some") return yield* effect;
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
          const result = yield* effect;
          yield* refreshNotedFacts.pipe(Effect.provideService(PgClient.PgClient, sql));
          return result;
        }),
      )
      .pipe(
        // Postgres can report a serialization failure at COMMIT, and the SQL client
        // turns any commit failure into a defect. Recover it so it is retried too.
        Effect.catchDefect((defect) =>
          Schema.is(SqlError.SqlError)(defect) ? Effect.fail(defect) : Effect.die(defect),
        ),
        Effect.retry({
          while: (error) =>
            Schema.is(SqlError.SqlError)(error) &&
            (error.reason._tag === "SerializationError" || error.reason._tag === "DeadlockError"),
          times: 8,
          schedule: Schedule.exponential("20 millis").pipe(Schedule.jittered),
        }),
      );
  });
