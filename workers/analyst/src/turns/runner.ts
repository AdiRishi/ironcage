import type { TurnId } from "@repo/contracts/analyst";
import { CommandId, type ModelProvider } from "@repo/contracts/finance";
import { calendarDateIn } from "@repo/finance";
import type { AnalystOperation, Api } from "@repo/infra/api";
import { Context, DateTime, Effect, Layer } from "effect";
import { Chat, type Prompt } from "effect/unstable/ai";
import { SqlClient } from "effect/unstable/sql";
import { v5 } from "uuid";

import { citedAnswer } from "../answers/cited.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { callModel, failureOf, modelUsage } from "../platform/model.ts";
import { AnalystModel } from "../platform/services.ts";
import {
  finishTurn,
  readAnswers,
  type StartedTurn,
  startTurn,
  type TurnOutcome,
} from "../storage/conversations.ts";
import { AnalystToolkit, analystTools, unavailableIn } from "../tools/toolkit.ts";
import { readContext, readShown } from "./context.ts";
import { earlierTurn, systemPrompt } from "./prompt.ts";

// The most model calls an attempt at a turn makes to reach an accepted answer.
const modelCalls = 12;

// A call's usage takes its command ID from the attempt and the call, so recording the same
// call again stores nothing new, and a turn that starts again records its new calls beside
// the old ones.
const usageId = (turn: StartedTurn, call: number) =>
  CommandId.make(v5(`${turn.id}/${turn.attempt}/${call}`, v5.URL));

const messages = {
  exhausted:
    "The analyst could not finish an answer with linked figures. Ask again or narrow the question.",
  unreachable: "The analyst could not reach the model. Ask again in a few minutes.",
  refused:
    "The model turned down the analyst's request. Ask the question another way, or in a new conversation.",
  unreadable: "The analyst could not read the model's reply. Ask again.",
};

export class TurnRunner extends Context.Service<
  TurnRunner,
  {
    // Answers a queued turn, or starts again on one an earlier attempt left running.
    readonly run: (id: TurnId) => Effect.Effect<void>;
  }
>()("@repo/analyst/turns/TurnRunner") {
  static readonly layer = (api: Pick<Api, AnalystOperation>) =>
    Layer.effect(
      TurnRunner,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const models = yield* AnalystModel;
        const toolkit = yield* AnalystToolkit;

        // The ledger the model reads about, the conversation so far, what the person read of
        // what they asked about, the question, and the reads of it.
        const promptFor = Effect.fnUntraced(function* (turn: StartedTurn) {
          const evidence = yield* TurnEvidence;
          const system = systemPrompt({
            today: calendarDateIn(yield* DateTime.now, evidence.timezone),
            timezone: evidence.timezone,
            currency: evidence.currency,
            accounts: evidence.accounts,
          });
          return [
            { role: "system", content: system },
            ...(yield* readAnswers(turn.conversationId)).flatMap(earlierTurn),
            ...(turn.context === null ? [] : yield* readShown(turn.context)),
            { role: "user", content: turn.question },
            ...(turn.context === null ? [] : yield* readContext(toolkit, turn.context)),
          ] satisfies ReadonlyArray<Prompt.MessageEncoded>;
        });

        const answer = Effect.fnUntraced(function* (turn: StartedTurn, provider: ModelProvider) {
          const evidence = yield* TurnEvidence;
          const chat = yield* Chat.fromPrompt(yield* promptFor(turn));
          for (let call = 1; call <= modelCalls; call++) {
            const response = yield* callModel(
              chat.generateText({ prompt: [], toolkit, toolChoice: "required", concurrency: 1 }),
              (usage) =>
                api.recordModelUsage(modelUsage("analyst", usageId(turn, call), provider, usage)),
            ).pipe(Effect.annotateLogs({ attempt: turn.attempt, call }));
            const snapshot = yield* evidence.snapshot;
            if (snapshot.accepted)
              return {
                status: "answered",
                answer: citedAnswer(snapshot.accepted, snapshot),
                nextReference: snapshot.nextReference,
              } satisfies TurnOutcome;
            const unavailable = unavailableIn(response.toolResults);
            if (unavailable) return yield* unavailable;
          }
          return { status: "failed", message: messages.exhausted } satisfies TurnOutcome;
        });

        const outcomeOf = Effect.fnUntraced(
          function* (turn: StartedTurn) {
            const allowance = yield* api.getModelAllowance({ task: "analyst" });
            if (!allowance.allowed)
              return { status: "blocked", message: allowance.message } satisfies TurnOutcome;
            return yield* answer(turn, allowance.provider).pipe(
              Effect.provide(
                Layer.mergeAll(
                  TurnEvidence.layer(api, turn.id),
                  models.session(turn.conversationId),
                ),
              ),
            );
          },
          // An API that did not answer, or a model that could not, ends the turn with a
          // message that says what to do.
          Effect.catchTags({
            FinanceError: (error) =>
              Effect.succeed({ status: "failed", message: error.message } satisfies TurnOutcome),
            AiError: (error) =>
              Effect.logError("The analyst's model call failed", {
                reason: error.reason._tag,
              }).pipe(
                Effect.as({
                  status: "failed",
                  message: messages[failureOf(error)],
                } satisfies TurnOutcome),
              ),
          }),
        );

        const run = Effect.fn("TurnRunner.run")(
          function* (id: TurnId) {
            const turn = yield* startTurn(id);
            const outcome = yield* outcomeOf(turn);
            yield* finishTurn(id, outcome);
            yield* Effect.logInfo("The analyst finished a turn", {
              attempt: turn.attempt,
              status: outcome.status,
            });
          },
          Effect.provideService(SqlClient.SqlClient, sql),
          // The object's own SQLite failing is a defect, and the alarm runs the turn again.
          Effect.orDie,
          (effect, id) => Effect.annotateLogs(effect, { turnId: id }),
        );
        return TurnRunner.of({ run });
      }),
    ).pipe(Layer.provide(analystTools(api)));
}
