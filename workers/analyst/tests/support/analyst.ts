import * as SqliteNode from "@effect/sql-sqlite-node/SqliteClient";
import type { AskContext, ConversationId } from "@repo/contracts/analyst";
import {
  CommandId,
  type ModelAllowance,
  type ModelProvider,
  type RecordModelUsage,
} from "@repo/contracts/finance";
import type { AnalystOperation, ApiClient } from "@repo/infra/api";
import { Context, Effect, Layer, Ref } from "effect";

import { Conversations } from "../../src/conversations/service.ts";
import { Alarm } from "../../src/platform/services.ts";
import { analystServices } from "../../src/services.ts";
import { migrate } from "../../src/storage/migrations.ts";
import { WorkScheduler } from "../../src/work/scheduler.ts";
import { ledgerApi } from "./ledger.ts";
import { scriptedAnalystModel } from "./model.ts";

// Whether the object's one alarm is set. Setting it again while it is set changes nothing.
class PendingAlarm extends Context.Service<PendingAlarm, Ref.Ref<boolean>>()(
  "@repo/analyst/tests/PendingAlarm",
) {
  static readonly layer = Layer.effect(PendingAlarm, Ref.make(false));
}

const alarm = Layer.effect(
  Alarm,
  Effect.gen(function* () {
    const pending = yield* PendingAlarm;
    return Alarm.of({ set: Ref.set(pending, true) });
  }),
);

export const alarmPending = PendingAlarm.use(Ref.get);

// What the platform does when the alarm goes off: the alarm is no longer set, and the
// scheduled work runs.
export const fireAlarm = Effect.gen(function* () {
  yield* Ref.set(yield* PendingAlarm, false);
  yield* (yield* WorkScheduler).runNext;
});

// The model usage the API stored, by command ID. Like the API, it stores a repeated
// command ID once.
class RecordedUsage extends Context.Service<
  RecordedUsage,
  Ref.Ref<ReadonlyMap<typeof CommandId.Type, typeof RecordModelUsage.Type>>
>()("@repo/analyst/tests/RecordedUsage") {
  static readonly layer = Layer.effect(
    RecordedUsage,
    Ref.make<ReadonlyMap<typeof CommandId.Type, typeof RecordModelUsage.Type>>(new Map()),
  );
}

export const recordedUsage = RecordedUsage.use(Ref.get).pipe(
  Effect.map((usage) => [...usage.values()]),
);

// The object's services over a fresh in-memory SQLite database with its migrations, the
// ledger API with `reads`, and a model that answers with `replies`.
export const analystTest = (
  reads: Partial<ApiClient<AnalystOperation>>,
  replies: Parameters<typeof scriptedAnalystModel>[0] = [],
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const usage = yield* RecordedUsage;
      return analystServices(
        ledgerApi({
          recordModelUsage: (input) =>
            Ref.update(usage, (stored) =>
              stored.has(input.commandId) ? stored : new Map([...stored, [input.commandId, input]]),
            ).pipe(
              Effect.as({
                id: input.commandId,
                task: input.task,
                model: input.model,
                occurredAt: "2026-09-02T01:00:00.000Z",
                inputTokens: input.inputTokens,
                outputTokens: input.outputTokens,
                cost: input.cost,
                status: input.status,
              }),
            ),
          ...reads,
        }),
      );
    }),
  ).pipe(
    Layer.provide(alarm),
    Layer.provideMerge(scriptedAnalystModel(replies)),
    Layer.provideMerge(RecordedUsage.layer),
    Layer.provideMerge(PendingAlarm.layer),
    Layer.provideMerge(
      Layer.effectDiscard(migrate).pipe(
        Layer.provideMerge(SqliteNode.layer({ filename: ":memory:" })),
      ),
    ),
  );

export const analystOff = Effect.succeed({
  allowed: false,
  message: "The analyst is off. Turn it on in Settings.",
} satisfies typeof ModelAllowance.Type);

// Workers AI's list prices for the analyst's model.
const provider = {
  name: "Cloudflare Workers AI",
  model: "@cf/zai-org/glm-5.3-flash",
  inputMicrousdPerMillion: 150_000n,
  cachedInputMicrousdPerMillion: 30_000n,
  outputMicrousdPerMillion: 500_000n,
} satisfies ModelProvider;

export const analystOn = Effect.succeed({
  allowed: true,
  provider,
} satisfies typeof ModelAllowance.Type);

export const commandId = (n: number) =>
  CommandId.make(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
export const question = "What did I spend on food in August?";

export const turnOf = Effect.fn("turnOf")(function* (conversationId: ConversationId) {
  const { turns } = yield* (yield* Conversations).get({ conversationId });
  const turn = turns.at(-1);
  if (!turn) return yield* Effect.die("The conversation has no turn.");
  return turn;
});

// Asks in a new conversation, or in `conversationId`, and runs the turn as the alarm does.
export const askAndRun = Effect.fn("askAndRun")(function* (
  n: number,
  options: {
    readonly question?: string;
    readonly context?: AskContext;
    readonly conversationId?: ConversationId;
  } = {},
) {
  const conversation = yield* (yield* Conversations).ask({
    commandId: commandId(n),
    conversationId: options.conversationId ?? null,
    question: options.question ?? question,
    context: options.context ?? null,
  });
  yield* fireAlarm;
  return yield* turnOf(conversation.id);
});
