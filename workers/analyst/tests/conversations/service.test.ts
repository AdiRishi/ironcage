import { describe, expect, it } from "@effect/vitest";
import { type AskContext, ConversationId, TurnId } from "@repo/contracts/analyst";
import { CategoryId, CommandId, YearMonth } from "@repo/contracts/finance";
import { Deferred, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

import { Conversations } from "../../src/conversations/service.ts";
import { alarmPending, analystOff, analystTest, fireAlarm } from "../support/analyst.ts";

const commandId = (n: number) =>
  CommandId.make(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
const foodInAugust = {
  kind: "category",
  period: { kind: "months", from: YearMonth.make("2026-08"), to: YearMonth.make("2026-08") },
  comparison: { kind: "previous" },
  category: { kind: "category", id: CategoryId.make("00000000-0000-4000-8000-00000000f00d") },
  counterparty: { kind: "all" },
} satisfies AskContext;

describe("Conversations", () => {
  it.effect("a question starts a conversation titled from it and waits for the analyst", () =>
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      const question =
        "Why did my food spending go up so much in August compared with July,\nand which places drove it?";
      const conversation = yield* conversations.ask({
        commandId: commandId(1),
        conversationId: null,
        question,
        context: foodInAugust,
      });
      const id = ConversationId.make(commandId(1));
      const title =
        "Why did my food spending go up so much in August compared with July, and which…";
      expect(conversation).toEqual({
        id,
        title,
        turns: [
          {
            id: TurnId.make(commandId(1)),
            question,
            context: foodInAugust,
            status: "queued",
            steps: [],
            answer: null,
            message: null,
            askedAt: "1970-01-01T00:00:00.000Z",
            finishedAt: null,
          },
        ],
      });
      expect(yield* conversations.list({})).toEqual({
        rows: [{ id, title, updatedAt: "1970-01-01T00:00:00.000Z", answering: true }],
        nextCursor: null,
      });
      expect(yield* alarmPending).toBe(true);
    }).pipe(Effect.provide(analystTest({ getModelAllowance: () => analystOff }))),
  );

  it.effect("a conversation takes its next question only after the analyst finishes one", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const allowance = () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(analystOff),
        );
      yield* Effect.gen(function* () {
        const conversations = yield* Conversations;
        const conversationId = ConversationId.make(commandId(1));
        const followUp = {
          commandId: commandId(2),
          conversationId,
          question: "And in July?",
          context: null,
        };
        yield* conversations.ask({
          commandId: commandId(1),
          conversationId: null,
          question: "What did I spend on food in August?",
          context: null,
        });
        expect((yield* conversations.ask(followUp).pipe(Effect.flip)).kind).toBe("conflict");
        const run = yield* Effect.forkChild(fireAlarm);
        yield* Deferred.await(started);
        expect((yield* conversations.ask(followUp).pipe(Effect.flip)).kind).toBe("conflict");
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);
        const conversation = yield* conversations.ask(followUp);
        expect(conversation.turns.map((turn) => [turn.question, turn.status])).toEqual([
          ["What did I spend on food in August?", "blocked"],
          ["And in July?", "queued"],
        ]);
      }).pipe(Effect.provide(analystTest({ getModelAllowance: allowance })));
    }),
  );

  it.effect("repeating an ask with its command ID returns its turn without queuing another", () =>
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      const ask = {
        commandId: commandId(1),
        conversationId: null,
        question: "What did I spend on food in August?",
        context: foodInAugust,
      };
      const first = yield* conversations.ask(ask);
      expect(yield* conversations.ask(ask)).toEqual(first);
      expect((yield* conversations.list({})).rows).toHaveLength(1);
      const reused = yield* conversations
        .ask({ ...ask, question: "What did I spend on food in July?" })
        .pipe(Effect.flip);
      expect(reused.kind).toBe("conflict");
    }).pipe(Effect.provide(analystTest({ getModelAllowance: () => analystOff }))),
  );

  it.effect("the conversation list pages from the one asked in most recently", () =>
    Effect.gen(function* () {
      const conversations = yield* Conversations;
      for (let n = 1; n <= 31; n++) {
        yield* conversations.ask({
          commandId: commandId(n),
          conversationId: null,
          question: `Question ${n}`,
          context: null,
        });
        yield* fireAlarm;
        yield* TestClock.adjust("1 minute");
      }
      yield* conversations.ask({
        commandId: commandId(32),
        conversationId: ConversationId.make(commandId(1)),
        question: "Question 1, again",
        context: null,
      });
      const first = yield* conversations.list({});
      expect(first.rows.map((row) => row.title)).toEqual([
        "Question 1",
        ...Array.from({ length: 29 }, (_, index) => `Question ${31 - index}`),
      ]);
      expect(first.rows.map((row) => row.answering)).toEqual([true, ...Array(29).fill(false)]);
      if (!first.nextCursor) return yield* Effect.die("Expected a second page");
      const second = yield* conversations.list({ cursor: first.nextCursor });
      expect(second).toEqual({
        rows: [
          {
            id: ConversationId.make(commandId(2)),
            title: "Question 2",
            updatedAt: "1970-01-01T00:01:00.000Z",
            answering: false,
          },
        ],
        nextCursor: null,
      });
    }).pipe(Effect.provide(analystTest({ getModelAllowance: () => analystOff }))),
  );
});
