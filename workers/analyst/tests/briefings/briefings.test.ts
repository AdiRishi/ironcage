import { describe, expect, it } from "@effect/vitest";
import {
  CalendarDate,
  EventId,
  type Import,
  ImportId,
  type ModelAllowance,
  PostingId,
  type Question,
  QuestionId,
  SourceFileId,
  YearMonth,
} from "@repo/contracts/finance";
import type { ApiClient, AnalystOperation } from "@repo/infra/api";
import { RpcCallError } from "alchemy/Cloudflare/Bridge";
import { DateTime, Effect, Ref } from "effect";
import { TestClock } from "effect/testing";
import { AiError } from "effect/unstable/ai";

import { Briefings } from "../../src/briefings/service.ts";
import { Conversations } from "../../src/conversations/service.ts";
import { ReadFlow } from "../../src/tools/flow.ts";
import { ListQuestions } from "../../src/tools/questions.ts";
import {
  alarmPending,
  analystOff,
  analystOn,
  analystTest,
  askAndRun,
  commandId,
  failedRun,
  fireAlarm,
  recordedUsage,
  turnOf,
} from "../support/analyst.ts";
import { flowInAugust, mastercard, questionsInAugust } from "../support/ledger.ts";
import {
  callTools,
  callToolsReading,
  lastResult,
  modelRequest,
  modelRequests,
  requestFails,
} from "../support/model.ts";

const august = YearMonth.make("2026-08");
const at = (instant: string) =>
  TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(instant)));
// 00:30 on 1 September 2026 in Sydney, where the ledger keeps its dates, is still 31 August
// in UTC.
const septemberStarts = at("2026-08-31T14:30:00Z");
const aud = (minor: bigint) => ({ currency: "AUD", minor });
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// The reads of August 2026, while the analyst may call its model.
const reads = {
  getModelAllowance: () => analystOn,
  getPeriodFlow: () => Effect.succeed(flowInAugust),
  summarizeQuestions: () => Effect.succeed(questionsInAugust),
  listQuestions: () => Effect.succeed({ rows: [], nextCursor: null }),
  listImports: () => Effect.succeed({ rows: [], nextCursor: null }),
} satisfies Partial<ApiClient<AnalystOperation>>;

// A September salary payment that was dated in August is moved into August.
const moreCameIn = {
  ...flowInAugust,
  totals: { ...flowInAugust.totals, inflow: aud(900000n), income: aud(900000n) },
};

const usageAtWarning = {
  allowed: false,
  message: "Model usage reached the warning in Settings. Raise it to continue.",
} satisfies typeof ModelAllowance.Type;

// A briefing that cites what came in and went out, spending's change, and the open
// questions, as the reads it was given returned them.
const writeBriefing = (wentOut?: string) =>
  callToolsReading((prompt) =>
    Effect.gen(function* () {
      const flow = yield* lastResult(ReadFlow, prompt);
      const questions = yield* lastResult(ListQuestions, prompt);
      return [
        {
          name: "WriteBriefing",
          params: {
            cameIn: `${flow.cameIn.amount.figure} came in during August 2026, all of it salary.`,
            wentOut: wentOut ?? `${flow.wentOut.amount.figure} went out in August 2026.`,
            changed: `Spending changed by ${flow.spending.comparison?.change.figure} from July 2026.`,
            needsAnswer: `${questions.questions.figure} need an answer in August 2026.`,
          },
        },
      ];
    }),
  );
const written = writeBriefing();
const writesAnAmount = writeBriefing("$3,100.00 went out in August 2026.");
const turnedDown = requestFails(new AiError.AuthenticationError({ kind: "InvalidKey" }));

const briefingOf = (month: YearMonth) => Briefings.use((briefings) => briefings.get({ month }));
const requestAugust = Effect.gen(function* () {
  yield* at("2026-09-02T01:00:00Z");
  return yield* Briefings.use((briefings) => briefings.request({ month: august }));
});
// Asks for August's briefing on 2 September 2026, and writes it as the alarm does.
const writeAugust = Effect.gen(function* () {
  yield* requestAugust;
  yield* fireAlarm;
  return yield* briefingOf(august);
});

// An open question about payments written "SQ *CAFE", two of them in August 2026, on the
// day of its latest payment.
const cafeQuestion = (latest: { readonly on: string; readonly count: number }) =>
  ({
    kind: "unresolved",
    id: QuestionId.make(id(1)),
    affects: {
      eventCount: latest.count,
      outflow: aud(500n * BigInt(latest.count)),
      inflow: aud(0n),
      firstOn: CalendarDate.make("2026-08-03"),
      lastOn: CalendarDate.make(latest.on),
    },
    affectsInPeriod: { eventCount: 2, outflow: aud(1000n), inflow: aud(0n) },
    samples: [
      {
        eventId: EventId.make(id(2)),
        postingId: PostingId.make(id(3)),
        postedOn: CalendarDate.make(latest.on),
        description: `SQ *CAFE SYDNEY ${latest.on}`,
        amount: aud(-500n),
      },
    ],
    subject: { kind: "alias", aliasKey: "SQ CAFE", aliasVersion: null },
  }) satisfies Question;
const failedStatement = {
  id: ImportId.make(id(4)),
  sourceFileId: SourceFileId.make(id(5)),
  accountId: mastercard.id,
  fileName: "Mastercard September 2026.csv",
  format: "csv",
  status: "failed",
  summary: null,
  failure: { message: "The file could not be read." },
  version: 1,
  createdAt: "2026-09-06T00:00:00.000Z",
} satisfies Import;

describe("Briefings", () => {
  it.effect(
    "the hourly run queues last month's briefing in the settings timezone once, and a later run queues nothing",
    () =>
      Effect.gen(function* () {
        const briefings = yield* Briefings;
        yield* septemberStarts;
        yield* briefings.queueLastMonth;
        expect(yield* alarmPending).toBe(true);
        expect(yield* briefings.list).toEqual([
          { month: "2026-08", status: "writing", writtenAt: null },
        ]);
        yield* fireAlarm;
        yield* briefings.queueLastMonth;
        expect(yield* alarmPending).toBe(false);
        expect(yield* briefings.list).toEqual([
          { month: "2026-08", status: "ready", writtenAt: "2026-08-31T14:30:00.000Z" },
        ]);
        expect(yield* modelRequests).toHaveLength(1);
      }).pipe(Effect.provide(analystTest(reads, [written]))),
  );

  const queuesNothing = (overrides: Partial<ApiClient<AnalystOperation>>) =>
    Effect.gen(function* () {
      const briefings = yield* Briefings;
      yield* briefings.queueLastMonth;
      expect(yield* briefings.list).toEqual([]);
      expect(yield* alarmPending).toBe(false);
    }).pipe(Effect.provide(analystTest({ ...reads, ...overrides })));

  it.effect("the hourly run queues nothing while the analyst is off", () =>
    septemberStarts.pipe(Effect.andThen(queuesNothing({ getModelAllowance: () => analystOff }))),
  );

  it.effect("the hourly run queues nothing while facts wait to be rebuilt", () =>
    septemberStarts.pipe(
      Effect.andThen(
        queuesNothing({ getFactsStatus: () => Effect.succeed({ outdated: 12, rebuilding: true }) }),
      ),
    ),
  );

  // The accounts' records start in January 2026.
  it.effect("the hourly run queues nothing for a month without records", () =>
    at("2026-01-01T02:00:00Z").pipe(Effect.andThen(queuesNothing({}))),
  );

  it.effect(
    "a briefing's figure tokens stand for the figures the reads gave, with the gaps they have",
    () =>
      Effect.gen(function* () {
        const briefing = yield* writeAugust;
        expect(briefing).toMatchObject({ status: "ready", message: null });
        const figure = (label: string) => {
          const found = briefing.figures.find((item) => item.label === label);
          expect(JSON.stringify(briefing.sections)).toContain(`[[${found?.id}]]`);
          return found?.value;
        };
        expect(figure("Came in, August 2026")).toEqual({
          kind: "money",
          amount: aud(850000n),
          signed: false,
        });
        expect(figure("Spending, change from July 2026 to August 2026")).toEqual({
          kind: "money",
          amount: aud(10000n),
          signed: true,
        });
        expect(figure("Open questions in August 2026")).toEqual({
          kind: "count",
          count: 2,
          unit: "question",
        });
        expect(briefing.limits.map((limit) => limit.kind)).toEqual([
          "missingRecords",
          "notUnderstood",
        ]);
      }).pipe(Effect.provide(analystTest(reads, [written]))),
  );

  it.effect(
    "a briefing whose cited figure changed after it was written shows no sections and is written again",
    () =>
      Effect.gen(function* () {
        const flow = yield* Ref.make(flowInAugust);
        yield* Effect.gen(function* () {
          expect((yield* writeAugust).status).toBe("ready");
          yield* Ref.set(flow, moreCameIn);
          expect(yield* briefingOf(august)).toEqual({
            month: "2026-08",
            status: "writing",
            sections: null,
            figures: [],
            records: [],
            basis: null,
            limits: [],
            writtenAt: null,
            message: null,
          });
          expect(yield* alarmPending).toBe(true);
          yield* fireAlarm;
          const rewritten = yield* briefingOf(august);
          expect(rewritten.status).toBe("ready");
          expect(
            rewritten.figures.find((item) => item.label === "Came in, August 2026")?.value,
          ).toMatchObject({ amount: aud(900000n) });
        }).pipe(
          Effect.provide(
            analystTest({ ...reads, getPeriodFlow: () => Ref.get(flow) }, [written, written]),
          ),
        );
      }),
  );

  it.effect(
    "a briefing is written again when a figure it did not cite changes, such as the money behind its open questions",
    () =>
      Effect.gen(function* () {
        const questions = yield* Ref.make(questionsInAugust);
        yield* Effect.gen(function* () {
          yield* writeAugust;
          yield* Ref.set(questions, { ...questionsInAugust, outflow: aud(9450n) });
          expect((yield* briefingOf(august)).status).toBe("writing");
          yield* fireAlarm;
          expect((yield* briefingOf(august)).status).toBe("ready");
          expect(yield* modelRequests).toHaveLength(2);
        }).pipe(
          Effect.provide(
            analystTest({ ...reads, summarizeQuestions: () => Ref.get(questions) }, [
              written,
              written,
            ]),
          ),
        );
      }),
  );

  it.effect(
    "a briefing stays ready when September's records change its question's dates and descriptions, or a file fails to import",
    () =>
      Effect.gen(function* () {
        const september = yield* Ref.make(false);
        yield* Effect.gen(function* () {
          yield* writeAugust;
          yield* Ref.set(september, true);
          expect((yield* briefingOf(august)).status).toBe("ready");
          expect(yield* alarmPending).toBe(false);
          expect(yield* modelRequests).toHaveLength(1);
        }).pipe(
          Effect.provide(
            analystTest(
              {
                ...reads,
                listQuestions: () =>
                  Ref.get(september).pipe(
                    Effect.map((arrived) => ({
                      rows: [
                        cafeQuestion(
                          arrived ? { on: "2026-09-05", count: 3 } : { on: "2026-08-20", count: 2 },
                        ),
                      ],
                      nextCursor: null,
                    })),
                  ),
                listImports: () =>
                  Ref.get(september).pipe(
                    Effect.map((arrived) => ({
                      rows: arrived ? [failedStatement] : [],
                      nextCursor: null,
                    })),
                  ),
              },
              [written],
            ),
          ),
        );
      }),
  );

  it.effect("a briefing read later, from the same figures calculated again, stays ready", () =>
    Effect.gen(function* () {
      yield* writeAugust;
      yield* TestClock.adjust("1 hour");
      expect((yield* briefingOf(august)).status).toBe("ready");
      expect(yield* modelRequests).toHaveLength(1);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            ...reads,
            getPeriodFlow: () =>
              DateTime.now.pipe(
                Effect.map((now) => ({ ...flowInAugust, calculatedAt: DateTime.formatIso(now) })),
              ),
          },
          [written],
        ),
      ),
    ),
  );

  it.effect(
    "a stale briefing read while facts are rebuilt waits for the rebuild instead of being written again",
    () =>
      Effect.gen(function* () {
        const outdated = yield* Ref.make(0);
        yield* Effect.gen(function* () {
          yield* writeAugust;
          yield* Ref.set(outdated, 40);
          expect((yield* briefingOf(august)).status).toBe("writing");
          expect(yield* alarmPending).toBe(false);
          yield* Ref.set(outdated, 0);
          expect((yield* briefingOf(august)).status).toBe("ready");
          expect(yield* modelRequests).toHaveLength(1);
        }).pipe(
          Effect.provide(
            analystTest(
              {
                ...reads,
                getFactsStatus: () =>
                  Ref.get(outdated).pipe(
                    Effect.map((count) => ({ outdated: count, rebuilding: count > 0 })),
                  ),
              },
              [written],
            ),
          ),
        );
      }),
  );

  it.effect(
    "a stale briefing read while the analyst is off says why, and is written again on the first read once it is on",
    () =>
      Effect.gen(function* () {
        const flow = yield* Ref.make(flowInAugust);
        const allowance = yield* Ref.make<typeof ModelAllowance.Type>(yield* analystOn);
        yield* Effect.gen(function* () {
          yield* writeAugust;
          yield* Ref.set(flow, moreCameIn);
          yield* Ref.set(allowance, yield* analystOff);
          expect(yield* briefingOf(august)).toMatchObject({
            status: "blocked",
            sections: null,
            message: "The analyst is off. Turn it on in Settings.",
          });
          expect(yield* alarmPending).toBe(false);
          yield* Ref.set(allowance, yield* analystOn);
          expect((yield* briefingOf(august)).status).toBe("writing");
          yield* fireAlarm;
          expect((yield* briefingOf(august)).status).toBe("ready");
        }).pipe(
          Effect.provide(
            analystTest(
              {
                ...reads,
                getPeriodFlow: () => Ref.get(flow),
                getModelAllowance: () => Ref.get(allowance),
              },
              [written, written],
            ),
          ),
        );
      }),
  );

  it.effect(
    "a briefing the analyst was blocked from writing gives the reason that holds when it is read, and is written once the analyst may",
    () =>
      Effect.gen(function* () {
        const allowance = yield* Ref.make<typeof ModelAllowance.Type>(yield* analystOn);
        yield* Effect.gen(function* () {
          yield* requestAugust;
          yield* Ref.set(allowance, yield* analystOff);
          yield* fireAlarm;
          expect(yield* briefingOf(august)).toMatchObject({
            status: "blocked",
            message: "The analyst is off. Turn it on in Settings.",
          });
          yield* Ref.set(allowance, usageAtWarning);
          expect(yield* briefingOf(august)).toMatchObject({
            status: "blocked",
            message: "Model usage reached the warning in Settings. Raise it to continue.",
          });
          expect(yield* Briefings.use((briefings) => briefings.list)).toEqual([
            { month: "2026-08", status: "blocked", writtenAt: null },
          ]);
          expect(yield* alarmPending).toBe(false);
          expect(yield* modelRequests).toEqual([]);
          yield* Ref.set(allowance, yield* analystOn);
          expect((yield* briefingOf(august)).status).toBe("writing");
          yield* fireAlarm;
          expect((yield* briefingOf(august)).status).toBe("ready");
        }).pipe(
          Effect.provide(
            analystTest({ ...reads, getModelAllowance: () => Ref.get(allowance) }, [written]),
          ),
        );
      }),
  );

  it.effect(
    "asking for a briefing while the analyst is off fails with the reason and keeps the briefing written before",
    () =>
      Effect.gen(function* () {
        const allowance = yield* Ref.make<typeof ModelAllowance.Type>(yield* analystOn);
        yield* Effect.gen(function* () {
          yield* writeAugust;
          yield* Ref.set(allowance, yield* analystOff);
          const error = yield* requestAugust.pipe(Effect.flip);
          expect(error).toMatchObject({
            kind: "unavailable",
            message: "The analyst is off. Turn it on in Settings.",
          });
          expect((yield* briefingOf(august)).status).toBe("ready");
          expect(yield* alarmPending).toBe(false);
        }).pipe(
          Effect.provide(
            analystTest({ ...reads, getModelAllowance: () => Ref.get(allowance) }, [written]),
          ),
        );
      }),
  );

  for (const { when, now, month, overrides, error } of [
    {
      when: "for a month that has not ended",
      now: "2026-08-31T10:00:00Z",
      month: august,
      overrides: {},
      error: { kind: "invalid", message: "August 2026 has not ended. Choose a month that has." },
    },
    {
      when: "for a month without records",
      now: "2026-09-02T01:00:00Z",
      month: YearMonth.make("2025-12"),
      overrides: {},
      error: {
        kind: "invalid",
        message: "No records for December 2025 yet. Upload the December 2025 statements.",
      },
    },
    {
      when: "while facts wait to be rebuilt",
      now: "2026-09-02T01:00:00Z",
      month: august,
      overrides: {
        getFactsStatus: () => Effect.succeed({ outdated: 12, rebuilding: true }),
      },
      error: {
        kind: "unavailable",
        message:
          "Ironcage is recalculating totals after an update. Write the briefing once it finishes.",
      },
    },
  ] satisfies ReadonlyArray<{
    readonly when: string;
    readonly now: string;
    readonly month: YearMonth;
    readonly overrides: Partial<ApiClient<AnalystOperation>>;
    readonly error: { readonly kind: string; readonly message: string };
  }>)
    it.effect(`a briefing cannot be asked for ${when}, and nothing is queued`, () =>
      Effect.gen(function* () {
        yield* at(now);
        const failure = yield* Briefings.use((briefings) => briefings.request({ month })).pipe(
          Effect.flip,
        );
        expect(failure).toMatchObject(error);
        expect((yield* briefingOf(month)).status).toBe("none");
        expect(yield* alarmPending).toBe(false);
      }).pipe(Effect.provide(analystTest({ ...reads, ...overrides }))),
    );

  it.effect(
    "a section that writes an amount goes back to the model, and the next one is kept",
    () =>
      Effect.gen(function* () {
        const briefing = yield* writeAugust;
        expect(briefing.status).toBe("ready");
        expect(
          briefing.figures.find((item) => item.label === "Went out, August 2026")?.value,
        ).toMatchObject({ amount: aud(310000n) });
        const requests = yield* modelRequests;
        expect(requests).toHaveLength(2);
        expect(requests[1]?.content.at(-1)).toMatchObject({
          role: "tool",
          content: [
            {
              type: "tool-result",
              name: "WriteBriefing",
              isFailure: true,
              result: {
                problems: [
                  'wentOut: "$3,100.00" writes an amount. Cite the figure that holds it instead.',
                ],
              },
            },
          ],
        });
      }).pipe(Effect.provide(analystTest(reads, [writesAnAmount, written]))),
  );

  it.effect(
    "a model that never writes sections that pass fails the briefing after three calls",
    () =>
      Effect.gen(function* () {
        expect(yield* writeAugust).toMatchObject({
          status: "failed",
          sections: null,
          message: "The analyst could not write this briefing with linked figures. Write it again.",
        });
        expect(yield* modelRequests).toHaveLength(3);
      }).pipe(Effect.provide(analystTest(reads, [writesAnAmount, writesAnAmount, writesAnAmount]))),
  );

  it.effect("asking again for a briefing that failed writes it again", () =>
    Effect.gen(function* () {
      expect((yield* writeAugust).status).toBe("failed");
      expect(yield* writeAugust).toMatchObject({ status: "ready", message: null });
    }).pipe(
      Effect.provide(analystTest(reads, [writesAnAmount, writesAnAmount, writesAnAmount, written])),
    ),
  );

  it.effect(
    "a briefing whose request the gateway turns down fails with that reason, and records its usage as unknown",
    () =>
      Effect.gen(function* () {
        expect(yield* writeAugust).toMatchObject({
          status: "failed",
          message: "The model turned down the analyst's request. Write the briefing again later.",
        });
        expect(yield* modelRequests).toHaveLength(1);
        expect(yield* recordedUsage).toMatchObject([
          { task: "briefing", inputTokens: null, outputTokens: null, cost: null, status: "failed" },
        ]);
      }).pipe(Effect.provide(analystTest(reads, [turnedDown]))),
  );

  it.effect(
    "each model call records its usage once for the task briefing, and a rewrite's calls beside the first write's",
    () =>
      Effect.gen(function* () {
        const flow = yield* Ref.make(flowInAugust);
        yield* Effect.gen(function* () {
          yield* writeAugust;
          yield* Ref.set(flow, moreCameIn);
          yield* briefingOf(august);
          yield* fireAlarm;
          expect((yield* briefingOf(august)).status).toBe("ready");
          // 600,000 uncached input tokens at $0.15, 400,000 cached at $0.03, and 100,000
          // output tokens at $0.50 a million come to $0.152, rounded up to 16 cents.
          const usage = {
            commandId: expect.any(String),
            task: "briefing",
            model: "@cf/zai-org/glm-5.3-flash",
            inputTokens: 1_000_000n,
            outputTokens: 100_000n,
            cost: { currency: "USD", minor: 16n },
            status: "success",
          };
          expect(yield* recordedUsage).toEqual([usage, usage, usage]);
        }).pipe(
          Effect.provide(
            analystTest({ ...reads, getPeriodFlow: () => Ref.get(flow) }, [
              writesAnAmount,
              written,
              written,
            ]),
          ),
        );
      }),
  );

  it.effect(
    "a briefing whose reads could not reach the API is written when the platform runs the alarm again",
    () =>
      Effect.gen(function* () {
        const reached = yield* Ref.make(false);
        yield* Effect.gen(function* () {
          yield* requestAugust;
          expect(yield* failedRun).toBe(true);
          expect((yield* briefingOf(august)).status).toBe("writing");
          yield* fireAlarm;
          expect((yield* briefingOf(august)).status).toBe("ready");
        }).pipe(
          Effect.provide(
            analystTest(
              {
                ...reads,
                getPeriodFlow: () =>
                  Ref.getAndSet(reached, true).pipe(
                    Effect.flatMap((again) =>
                      again
                        ? Effect.succeed(flowInAugust)
                        : Effect.fail(
                            new RpcCallError({
                              method: "getPeriodFlow",
                              cause: "Worker restarted",
                            }),
                          ),
                    ),
                  ),
              },
              [written],
            ),
          ),
        );
      }),
  );

  it.effect(
    "a briefing ends failed after five failed attempts, and a question asked meanwhile is answered first",
    () =>
      Effect.gen(function* () {
        yield* requestAugust;
        for (let attempt = 1; attempt <= 2; attempt++) expect(yield* failedRun).toBe(true);
        const conversation = yield* Conversations.use((conversations) =>
          conversations.ask({
            commandId: commandId(1),
            conversationId: null,
            question: "Is anything wrong with my records?",
            context: null,
          }),
        );
        yield* fireAlarm;
        expect((yield* turnOf(conversation.id)).status).toBe("blocked");
        for (let attempt = 3; attempt <= 5; attempt++) expect(yield* failedRun).toBe(true);
        yield* fireAlarm;
        expect(yield* briefingOf(august)).toMatchObject({
          status: "failed",
          message: "The analyst could not finish this briefing. Write it again.",
        });
        expect(yield* alarmPending).toBe(false);
      }).pipe(
        Effect.provide(
          analystTest({
            ...reads,
            getModelAllowance: ({ task }) => (task === "briefing" ? analystOn : analystOff),
            getPeriodFlow: () => Effect.die("The isolate was reset."),
          }),
        ),
      ),
  );

  it.effect("an alarm answers a waiting question before it writes a briefing", () =>
    Effect.gen(function* () {
      yield* requestAugust;
      const conversation = yield* Conversations.use((conversations) =>
        conversations.ask({
          commandId: commandId(1),
          conversationId: null,
          question: "Is anything wrong with my records?",
          context: null,
        }),
      );
      yield* fireAlarm;
      expect((yield* turnOf(conversation.id)).status).toBe("answered");
      expect((yield* briefingOf(august)).status).toBe("writing");
      expect(yield* alarmPending).toBe(true);
      yield* fireAlarm;
      expect((yield* briefingOf(august)).status).toBe("ready");
      expect(yield* alarmPending).toBe(false);
    }).pipe(
      Effect.provide(
        analystTest(reads, [
          callTools({ name: "Answer", params: { text: "Nothing looks wrong.", missing: [] } }),
          written,
        ]),
      ),
    ),
  );

  it.effect(
    "a question asked about a briefing follows the briefing as it read, and reads what it was written from",
    () =>
      Effect.gen(function* () {
        yield* writeAugust;
        const question = "Why do those questions need an answer?";
        const turn = yield* askAndRun(1, {
          question,
          context: { kind: "briefing", month: august },
        });
        expect(turn.steps.map((step) => step.label)).toEqual([
          "Reading money in and out for August 2026",
          "Reading the open questions in August 2026",
          "Checking the records for August 2026",
        ]);
        const asked = yield* modelRequest(1);
        expect(asked.content.slice(1, 4).map((message) => message.content)).toMatchObject([
          [{ type: "text", text: "Write the briefing of August 2026." }],
          [
            {
              type: "text",
              text: [
                "What came in:\n$8,500.00 came in during August 2026, all of it salary.",
                "What went out:\n$3,100.00 went out in August 2026.",
                "What changed from the month before:\nSpending changed by +$100.00 from July 2026.",
                "What needs an answer:\n2 questions need an answer in August 2026.",
              ].join("\n\n"),
            },
          ],
          [{ type: "text", text: question }],
        ]);
      }).pipe(
        Effect.provide(
          analystTest(reads, [
            written,
            callTools({ name: "Answer", params: { text: "They are unanswered.", missing: [] } }),
          ]),
        ),
      ),
  );
});
