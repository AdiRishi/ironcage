import { BriefingSections } from "@repo/contracts/analyst";
import { CommandId, type ModelProvider, type YearMonth } from "@repo/contracts/finance";
import { calendarDateIn } from "@repo/finance";
import type { AnalystOperation, Api } from "@repo/infra/api";
import { Context, Crypto, DateTime, Effect, Layer, Schema } from "effect";
import { Chat, type Response, Tool, Toolkit } from "effect/unstable/ai";
import { SqlClient } from "effect/unstable/sql";

import { checkAgainst } from "../answers/check.ts";
import { citedAnswer } from "../answers/cited.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { callModel, failureOf, modelUsage } from "../platform/model.ts";
import { AnalystModel } from "../platform/services.ts";
import { type BriefingOutcome, finishBriefing, startBriefing } from "../storage/briefings.ts";
import { AnalystToolkit, analystTools } from "../tools/toolkit.ts";
import { readBriefingFacts } from "./facts.ts";
import { briefingPrompt, briefingRequest } from "./prompt.ts";

// The most model calls a write makes to reach sections that pass their checks.
const modelCalls = 3;

const messages = {
  exhausted: "The analyst could not write this briefing with linked figures. Write it again.",
  unreachable: "The analyst could not reach the model. Write the briefing again in a few minutes.",
  refused: "The model turned down the analyst's request. Write the briefing again later.",
  unreadable: "The analyst could not read the model's reply. Write the briefing again.",
};

const Section = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(1000));

export const WriteBriefing = Tool.make("WriteBriefing", {
  description:
    "Finish the briefing with its four sections: cameIn, wentOut, changed, and needsAnswer. " +
    "Write each in a few sentences or a short list. Cite every amount, count, change, " +
    "percentage, and average as the figure token a read returned, such as [[f3]], and " +
    "name the period beside every figure. Write no other numbers, in digits or in words, " +
    "except dates, and no links. Separate paragraphs with a blank line, and start each " +
    'line of a list with "- ". A briefing with problems comes back with them; fix every ' +
    "one and write it again.",
  parameters: Schema.Struct({
    cameIn: Section,
    wentOut: Section,
    changed: Section,
    needsAnswer: Section,
  }),
  // The sections as the briefing keeps them.
  success: BriefingSections,
  failure: Schema.Struct({ problems: Schema.Array(Schema.String) }),
  failureMode: "return",
  dependencies: [TurnEvidence],
});

const BriefingToolkit = Toolkit.make(WriteBriefing);

// Checks every section against the facts the briefing is written from, and names the
// section beside each problem.
const writeBriefing = Effect.fn("WriteBriefing")(function* (
  sections: Tool.Parameters<typeof WriteBriefing>,
) {
  const check = checkAgainst(yield* (yield* TurnEvidence).snapshot);
  const problems = Object.entries(sections).flatMap(([section, text]) =>
    check(text).map((problem) => `${section}: ${problem}`),
  );
  if (problems.length > 0) return yield* Effect.fail({ problems });
  return sections;
});

export class BriefingWriter extends Context.Service<
  BriefingWriter,
  {
    // Writes the month's queued briefing, or starts again on one an earlier run left
    // writing.
    readonly write: (month: YearMonth) => Effect.Effect<void>;
  }
>()("@repo/analyst/briefings/BriefingWriter") {
  static readonly layer = (api: Pick<Api, AnalystOperation>) =>
    Layer.effect(
      BriefingWriter,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const crypto = yield* Crypto.Crypto;
        const models = yield* AnalystModel;
        const reads = yield* AnalystToolkit;
        const briefingTools = yield* BriefingToolkit;

        // A briefing is written again whenever its facts change, so each call's usage takes
        // a command ID of its own.
        const record = (provider: ModelProvider) => (usage: Response.Usage | null) =>
          crypto.randomUUIDv4.pipe(
            Effect.orDie,
            Effect.flatMap((id) =>
              api.recordModelUsage(modelUsage("briefing", CommandId.make(id), provider, usage)),
            ),
          );

        const writeSections = Effect.fnUntraced(function* (
          month: YearMonth,
          attempt: number,
          provider: ModelProvider,
        ) {
          const evidence = yield* TurnEvidence;
          const facts = yield* readBriefingFacts(reads, month);
          const chat = yield* Chat.fromPrompt([
            {
              role: "system",
              content: briefingPrompt({
                today: calendarDateIn(yield* DateTime.now, evidence.timezone),
                timezone: evidence.timezone,
                currency: evidence.currency,
                accounts: evidence.accounts,
              }),
            },
            { role: "user", content: briefingRequest(month) },
            ...facts.messages,
          ]);
          for (let call = 1; call <= modelCalls; call++) {
            const response = yield* callModel(
              chat.generateText({
                prompt: [],
                toolkit: briefingTools,
                toolChoice: "required",
                concurrency: 1,
              }),
              record(provider),
            ).pipe(Effect.annotateLogs({ attempt, call }));
            const [sections] = response.toolResults.flatMap((part) =>
              part.isFailure ? [] : [part.result],
            );
            if (sections) {
              const shown = citedAnswer(
                { text: Object.values(sections).join("\n\n"), missing: [] },
                facts.evidence,
              );
              return {
                status: "ready",
                written: {
                  fingerprint: facts.fingerprint,
                  sections,
                  figures: shown.figures,
                  records: shown.records,
                  basis: shown.basis,
                  limits: shown.limits,
                },
              } satisfies BriefingOutcome;
            }
          }
          return { status: "failed", failure: messages.exhausted } satisfies BriefingOutcome;
        });

        const outcomeOf = Effect.fnUntraced(
          function* (month: YearMonth, attempt: number) {
            const allowance = yield* api.getModelAllowance({ task: "briefing" });
            if (!allowance.allowed) return { status: "blocked" } satisfies BriefingOutcome;
            return yield* writeSections(month, attempt, allowance.provider).pipe(
              Effect.provide(
                Layer.mergeAll(
                  TurnEvidence.briefing(api, month),
                  models.session(`briefing/${month}`),
                ),
              ),
            );
          },
          // An API that fails `unavailable`, as it does when it cannot be reached, fails the
          // run, which the platform runs again. Any other failure of the API, or a model that
          // could not answer, fails the briefing with a message that says what to do.
          Effect.catchTags({
            FinanceError: (error) =>
              error.kind === "unavailable"
                ? Effect.fail(error)
                : Effect.succeed({
                    status: "failed",
                    failure: error.message,
                  } satisfies BriefingOutcome),
            AiError: (error) =>
              Effect.logError("The analyst's model call failed", {
                reason: error.reason._tag,
              }).pipe(
                Effect.as({
                  status: "failed",
                  failure: messages[failureOf(error)],
                } satisfies BriefingOutcome),
              ),
          }),
        );

        const write = Effect.fn("BriefingWriter.write")(
          function* (month: YearMonth) {
            const attempt = yield* startBriefing(month);
            const outcome = yield* outcomeOf(month, attempt);
            yield* finishBriefing(month, outcome);
            yield* Effect.logInfo("The analyst finished a briefing", {
              attempt,
              status: outcome.status,
            });
          },
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.provideService(Crypto.Crypto, crypto),
          // The object's own SQLite failing, or an API it could not reach, is a defect, and
          // the alarm writes the briefing again.
          Effect.orDie,
          (effect, month) => Effect.annotateLogs(effect, { month }),
        );
        return BriefingWriter.of({ write });
      }),
    ).pipe(
      Layer.provide([
        analystTools(api),
        BriefingToolkit.toLayer(BriefingToolkit.of({ WriteBriefing: writeBriefing })),
      ]),
    );
}
