import { PgClient } from "@effect/sql-pg";
import { FactsStatus, FinanceError } from "@repo/contracts/finance";
import { factsVersion } from "@repo/finance";
import { Context, Crypto, Effect, Layer, Schema } from "effect";

import { toFinanceError } from "../database/failures.ts";
import { writeTransaction } from "../database/transactions.ts";
import { ensureWorkflowStatus, FactJobs, workflowEnded } from "../platform/services.ts";
import { outdatedFacts, rebuildOutdatedFacts } from "./facts.ts";

export class FactRebuilds extends Context.Service<
  FactRebuilds,
  {
    readonly status: Effect.Effect<typeof FactsStatus.Type, FinanceError>;
    readonly rebuild: Effect.Effect<number, FinanceError>;
  }
>()("@repo/api/analysis/FactRebuilds") {
  static readonly layer = Layer.effect(
    FactRebuilds,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const crypto = yield* Crypto.Crypto;
      const jobs = yield* FactJobs;
      const start = Effect.gen(function* () {
        const rebuildId = yield* crypto.randomUUIDv4;
        yield* sql`INSERT INTO fact_rebuilds (version, instance_id) VALUES (${factsVersion}, ${rebuildId})
          ON CONFLICT (version) DO UPDATE SET instance_id = EXCLUDED.instance_id, started_at = now()`;
        yield* jobs.start({ rebuildId });
      });
      // Reading the status also keeps a rebuild running: it starts one when none has
      // started for this version, and a new one when the last ended with facts left.
      const status = Effect.gen(function* () {
        const outdated = yield* outdatedFacts.pipe(Effect.provideService(PgClient.PgClient, sql));
        if (outdated === 0) return { outdated, rebuilding: false };
        const [current] =
          yield* sql`SELECT instance_id AS "instanceId" FROM fact_rebuilds WHERE version = ${factsVersion}`.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Array(Schema.Struct({ instanceId: Schema.String })),
              ),
            ),
          );
        if (!current) {
          yield* start;
          return { outdated, rebuilding: true };
        }
        const state = yield* ensureWorkflowStatus(
          jobs,
          { rebuildId: current.instanceId },
          current.instanceId,
        );
        if (state && workflowEnded(state)) yield* start;
        return { outdated, rebuilding: true };
      }).pipe(toFinanceError);
      const rebuild = writeTransaction(
        sql,
        rebuildOutdatedFacts.pipe(Effect.provideService(PgClient.PgClient, sql)),
      ).pipe(toFinanceError);
      return FactRebuilds.of({ status, rebuild });
    }),
  );
}
