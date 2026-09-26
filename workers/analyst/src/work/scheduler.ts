import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { BriefingWriter } from "../briefings/writer.ts";
import { Alarm } from "../platform/services.ts";
import { finishBriefing, readBriefingsWaiting, readNextBriefing } from "../storage/briefings.ts";
import { finishTurn, readNextTurn, readWaiting } from "../storage/conversations.ts";
import { TurnRunner } from "../turns/runner.ts";

// A turn or briefing found running has failed its last attempt. After five, it ends failed
// instead of starting again. The turn or briefing keeps the count because every ask
// replaces the one alarm, and with it the platform's count of retries. Five attempts and
// the run that fails the work fit within the six retries Cloudflare gives a failed alarm.
const attemptsBeforeFailing = 5;

export class WorkScheduler extends Context.Service<
  WorkScheduler,
  {
    // Runs `runNext` as soon as the object is free.
    readonly schedule: Effect.Effect<void>;
    // Works on one queued item, a turn before any briefing, then schedules another run
    // while work remains. A failure fails the run, which the platform retries.
    readonly runNext: Effect.Effect<void>;
  }
>()("@repo/analyst/work/WorkScheduler") {
  static readonly layer = Layer.effect(
    WorkScheduler,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const alarm = yield* Alarm;
      const turns = yield* TurnRunner;
      const briefings = yield* BriefingWriter;
      // Turns come first, because someone is waiting for each answer.
      const runNextItem = Effect.gen(function* () {
        const turn = yield* readNextTurn;
        if (turn) {
          if (turn.status === "running" && turn.attempts >= attemptsBeforeFailing)
            return yield* finishTurn(turn.id, {
              status: "failed",
              message: "The analyst could not finish this answer. Ask again.",
            });
          return yield* turns.run(turn.id);
        }
        const briefing = yield* readNextBriefing;
        if (!briefing) return;
        if (briefing.status === "writing" && briefing.attempts >= attemptsBeforeFailing)
          return yield* finishBriefing(briefing.month, {
            status: "failed",
            failure: "The analyst could not finish this briefing. Write it again.",
          });
        yield* briefings.write(briefing.month);
      });
      const runNext = Effect.gen(function* () {
        yield* runNextItem;
        if ((yield* readWaiting) || (yield* readBriefingsWaiting)) yield* alarm.set;
      }).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.orDie,
        Effect.withSpan("WorkScheduler.runNext"),
      );
      return WorkScheduler.of({ schedule: alarm.set, runNext });
    }),
  );
}
