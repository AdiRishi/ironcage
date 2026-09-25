import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { Alarm } from "../platform/services.ts";
import { finishTurn, readNextTurn, readWaiting } from "../storage/conversations.ts";
import { TurnRunner } from "../turns/runner.ts";

// A turn found running has failed its last attempt. After five, it ends failed instead
// of starting again. The turn keeps the count because every ask replaces the one alarm,
// and with it the platform's count of retries. Five attempts and the run that fails the
// turn fit within the six retries Cloudflare gives a failed alarm.
const attemptsBeforeFailing = 5;

export class WorkScheduler extends Context.Service<
  WorkScheduler,
  {
    // Runs `runNext` as soon as the object is free.
    readonly schedule: Effect.Effect<void>;
    // Works on one queued item, then schedules another run while work remains. A
    // failure fails the run, which the platform retries.
    readonly runNext: Effect.Effect<void>;
  }
>()("@repo/analyst/work/WorkScheduler") {
  static readonly layer = Layer.effect(
    WorkScheduler,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const alarm = yield* Alarm;
      const turns = yield* TurnRunner;
      const runNext = Effect.gen(function* () {
        const turn = yield* readNextTurn;
        if (!turn) return;
        if (turn.status === "running" && turn.attempts >= attemptsBeforeFailing)
          yield* finishTurn(turn.id, {
            status: "failed",
            message: "The analyst could not finish this answer. Ask again.",
          });
        else yield* turns.run(turn.id);
        if (yield* readWaiting) yield* alarm.set;
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.orDie,
        Effect.withSpan("WorkScheduler.runNext"),
      );
      return WorkScheduler.of({ schedule: alarm.set, runNext });
    }),
  );
}
