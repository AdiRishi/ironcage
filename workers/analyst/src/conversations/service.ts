import {
  type Ask,
  type Conversation,
  ConversationId,
  type ConversationInput,
  type ConversationPage,
  type ListConversations,
  TurnId,
} from "@repo/contracts/analyst";
import { FinanceError } from "@repo/contracts/finance";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

import {
  ContextText,
  insertConversation,
  insertTurn,
  readAnswering,
  readAsked,
  readConversation,
  readConversationPage,
} from "../storage/conversations.ts";
import { toFinanceError } from "../storage/failures.ts";
import { WorkScheduler } from "../work/scheduler.ts";

const pageSize = 30;
const titleLength = 80;

const conversationTitle = (question: string) => {
  const line = question.replaceAll(/\s+/g, " ");
  return line.length <= titleLength ? line : `${line.slice(0, titleLength - 1).trimEnd()}…`;
};

export class Conversations extends Context.Service<
  Conversations,
  {
    readonly list: (
      input: typeof ListConversations.Type,
    ) => Effect.Effect<ConversationPage, FinanceError>;
    readonly get: (
      input: typeof ConversationInput.Type,
    ) => Effect.Effect<Conversation, FinanceError>;
    // Queues the question as a turn and schedules the work that answers it.
    readonly ask: (input: Ask) => Effect.Effect<Conversation, FinanceError>;
  }
>()("@repo/analyst/conversations/Conversations") {
  static readonly layer = Layer.effect(
    Conversations,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const scheduler = yield* WorkScheduler;
      const provide = Effect.provideService(SqlClient.SqlClient, sql);

      const list = Effect.fn("Conversations.list")(
        function* (input: typeof ListConversations.Type) {
          const rows = yield* readConversationPage(input.cursor, pageSize + 1);
          const page = rows.slice(0, pageSize);
          const last = page.at(-1);
          return {
            rows: page,
            nextCursor:
              rows.length > pageSize && last ? { updatedAt: last.updatedAt, id: last.id } : null,
          };
        },
        provide,
        toFinanceError,
      );

      const get = Effect.fn("Conversations.get")(
        function* ({ conversationId }: typeof ConversationInput.Type) {
          return yield* readConversation(conversationId);
        },
        provide,
        toFinanceError,
      );

      const ask = Effect.fn("Conversations.ask")(
        function* (input: Ask) {
          const id = TurnId.make(input.commandId);
          // A new conversation takes the ID of the ask that starts it, so repeating that
          // ask finds the same conversation.
          const conversationId = input.conversationId ?? ConversationId.make(input.commandId);
          const context = yield* Schema.encodeEffect(ContextText)(input.context);
          const queued = yield* sql.withTransaction(
            Effect.gen(function* () {
              const asked = yield* readAsked(id);
              if (asked) {
                if (
                  asked.conversationId !== conversationId ||
                  asked.question !== input.question ||
                  asked.context !== context
                )
                  return yield* new FinanceError({
                    kind: "conflict",
                    message: "This command ID was already used for another request.",
                  });
                return false;
              }
              if (input.conversationId === null)
                yield* insertConversation(conversationId, conversationTitle(input.question));
              else if (yield* readAnswering(conversationId))
                return yield* new FinanceError({
                  kind: "conflict",
                  message:
                    "The analyst is still answering the last question. Ask again once it has.",
                });
              yield* insertTurn({ id, conversationId, question: input.question, context });
              return true;
            }),
          );
          // No other I/O may come between queuing and scheduling, so the object commits the
          // turn and its alarm together.
          if (queued) yield* scheduler.schedule;
          return yield* readConversation(conversationId);
        },
        provide,
        toFinanceError,
      );

      return Conversations.of({ list, get, ask });
    }),
  );
}
