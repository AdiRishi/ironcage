import { describe, expect, it } from "@effect/vitest";
import { ConversationId } from "@repo/contracts/analyst";
import { CommandId } from "@repo/contracts/finance";
import { Effect, Exit, Ref } from "effect";
import { TestClock } from "effect/testing";

import { Conversations } from "../../src/conversations/service.ts";
import { alarmPending, analystOff, analystTest, fireAlarm } from "../support/analyst.ts";

const first = CommandId.make("00000000-0000-4000-8000-000000000001");
const second = CommandId.make("00000000-0000-4000-8000-000000000002");
const statusOf = Effect.fn("statusOf")(function* (commandId: typeof CommandId.Type) {
  const conversations = yield* Conversations;
  const conversation = yield* conversations.get({
    conversationId: ConversationId.make(commandId),
  });
  return conversation.turns.map(({ status, message }) => ({ status, message }));
});
const ask = Effect.fn("ask")(function* (commandId: typeof CommandId.Type, question: string) {
  const conversations = yield* Conversations;
  return yield* conversations.ask({ commandId, conversationId: null, question, context: null });
});
const failedRun = fireAlarm.pipe(Effect.exit, Effect.map(Exit.isFailure));

describe("WorkScheduler", () => {
  it.effect("an alarm answers one turn and stays set while turns wait", () =>
    Effect.gen(function* () {
      yield* ask(first, "What did I spend on food in August?");
      yield* TestClock.adjust("1 second");
      yield* ask(second, "What came in during August?");
      expect(yield* alarmPending).toBe(true);

      yield* fireAlarm;
      expect((yield* statusOf(first))[0]?.status).toBe("blocked");
      expect((yield* statusOf(second))[0]?.status).toBe("queued");
      expect(yield* alarmPending).toBe(true);

      yield* fireAlarm;
      expect((yield* statusOf(second))[0]?.status).toBe("blocked");
      expect(yield* alarmPending).toBe(false);
    }).pipe(Effect.provide(analystTest({ getModelAllowance: () => analystOff }))),
  );

  it.effect("a turn asked while the analyst is off ends blocked with the reason", () =>
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      yield* ask(first, "What did I spend on food in August?");
      yield* TestClock.adjust("2 seconds");
      yield* fireAlarm;
      const [turn] = (yield* conversations.get({ conversationId: ConversationId.make(first) }))
        .turns;
      expect(turn).toMatchObject({
        status: "blocked",
        message: "The analyst is off. Turn it on in Settings.",
        askedAt: "1970-01-01T00:00:00.000Z",
        finishedAt: "1970-01-01T00:00:02.000Z",
      });
      expect((yield* conversations.list({})).rows[0]?.answering).toBe(false);
    }).pipe(Effect.provide(analystTest({ getModelAllowance: () => analystOff }))),
  );

  it.effect("a turn an alarm left running starts again when the platform retries it", () =>
    Effect.gen(function* () {
      const firstAttempt = yield* Ref.make(true);
      const allowance = () =>
        Ref.getAndSet(firstAttempt, false).pipe(
          Effect.flatMap((isFirst) =>
            isFirst ? Effect.die("The isolate was reset.") : analystOff,
          ),
        );
      yield* Effect.gen(function* () {
        yield* ask(first, "What did I spend on food in August?");
        expect(yield* failedRun).toBe(true);
        expect(yield* statusOf(first)).toEqual([{ status: "running", message: null }]);
        yield* fireAlarm;
        expect(yield* statusOf(first)).toEqual([
          { status: "blocked", message: "The analyst is off. Turn it on in Settings." },
        ]);
      }).pipe(Effect.provide(analystTest({ getModelAllowance: allowance })));
    }),
  );

  it.effect("a turn ends failed after five failed attempts, however often others are asked", () =>
    Effect.gen(function* () {
      yield* ask(first, "What did I spend on food in August?");
      for (let attempt = 1; attempt <= 2; attempt++) expect(yield* failedRun).toBe(true);
      // Asking sets the alarm again, which starts the platform's count of retries over.
      yield* TestClock.adjust("1 second");
      yield* ask(second, "What came in during August?");
      for (let attempt = 3; attempt <= 5; attempt++) expect(yield* failedRun).toBe(true);

      yield* fireAlarm;
      expect(yield* statusOf(first)).toEqual([
        { status: "failed", message: "The analyst could not finish this answer. Ask again." },
      ]);
      expect(yield* statusOf(second)).toEqual([{ status: "queued", message: null }]);
      expect(yield* alarmPending).toBe(true);
    }).pipe(
      Effect.provide(
        analystTest({ getModelAllowance: () => Effect.die("The isolate was reset.") }),
      ),
    ),
  );
});
