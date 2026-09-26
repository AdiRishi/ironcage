import * as SqliteClient from "@effect/sql-sqlite-do/SqliteClient";
import { analystModel } from "@repo/contracts/finance";
import type { conversationBindings } from "@repo/infra/worker-bindings";
import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Clock, Context, Effect, Layer } from "effect";

import { Alarm, AnalystModel } from "../platform/services.ts";
import { Proposals } from "../proposals/service.ts";
import { analystServices } from "../services.ts";
import { migrate } from "../storage/migrations.ts";
import { WorkScheduler } from "../work/scheduler.ts";
import { Conversations } from "./service.ts";

const operations = Effect.gen(function* () {
  const conversations = yield* Conversations;
  const proposals = yield* Proposals;
  return {
    listConversations: conversations.list,
    getConversation: conversations.get,
    ask: conversations.ask,
    resolveProposal: proposals.resolve,
    refreshProposal: proposals.refresh,
  };
});
export type ConversationOperations = Effect.Success<typeof operations>;

// Runs once per activation, before the object takes any call or alarm.
export const conversations = Effect.fn("Conversations.activate")(function* (
  bindings: Effect.Success<ReturnType<typeof conversationBindings>>,
) {
  const state = yield* Cloudflare.DurableObjectState;
  const runtime = yield* RuntimeContext;
  const services = yield* Layer.build(
    analystServices(bindings.api).pipe(
      Layer.provide([
        Layer.succeed(Alarm, {
          set: Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => state.storage.setAlarm(now)),
            Effect.provideService(RuntimeContext, runtime),
          ),
        }),
        Layer.succeed(AnalystModel, {
          // Workers AI sends requests with the same session to the same model instance,
          // which reuses the prompt it cached for the conversation's earlier calls.
          conversation: (id) =>
            bindings.gateway
              .model({
                model: analystModel,
                parameters: { maxTokens: 4096, reasoningEffort: "low" },
                headers: { "x-session-affinity": id },
              })
              .pipe(Layer.provide(Layer.succeed(RuntimeContext, runtime))),
        }),
      ]),
      Layer.provideMerge(SqliteClient.layer({ storage: state.raw.storage })),
    ),
  );
  yield* migrate.pipe(Effect.provideContext(services), Effect.orDie);
  const scheduler = Context.get(services, WorkScheduler);
  return {
    ...(yield* operations.pipe(Effect.provideContext(services))),
    alarm: () => scheduler.runNext,
  };
});
