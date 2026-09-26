import { assert, describe, expect, it } from "@effect/vitest";
import { ConversationId } from "@repo/contracts/analyst";
import { FinanceError, YearMonth } from "@repo/contracts/finance";
import { RpcCallError } from "alchemy/Cloudflare/Bridge";
import { DateTime, Effect, Exit, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { AiError, Prompt } from "effect/unstable/ai";

import { Conversations } from "../../src/conversations/service.ts";
import { ReadSpending } from "../../src/tools/spending.ts";
import { ListTransactions } from "../../src/tools/transactions.ts";
import {
  analystOff,
  analystOn,
  analystTest,
  askAndRun,
  commandId,
  fireAlarm,
  question,
  recordedUsage,
  turnOf,
} from "../support/analyst.ts";
import {
  accountNumbers,
  everyday,
  flowInAugust,
  food,
  foodInAugust,
  mastercard,
  postingDetail,
  referenceData,
  unidentified,
  unidentifiedEvent,
  unresolvedOut,
  unresolvedPage,
} from "../support/ledger.ts";
import {
  callTools,
  callToolsReading,
  callToolsUnreported,
  lastResult,
  modelRequest,
  modelRequests,
  requestFails,
} from "../support/model.ts";

const august = {
  kind: "months",
  from: YearMonth.make("2026-08"),
  to: YearMonth.make("2026-08"),
} as const;
const foodSpending = {
  period: august,
  comparison: { kind: "previous" },
  category: { kind: "category", id: food },
  counterparty: { kind: "all" },
} as const;
// What Spending shows for Food in August 2026 against the month before.
const foodOnSpending = { kind: "spending", ...foodSpending } as const;
const readFood = callTools({ name: "ReadSpending", params: foodSpending });
const answer = (text: string) => callTools({ name: "Answer", params: { text, missing: [] } });
const readsFood = {
  getModelAllowance: () => analystOn,
  getSpending: () => Effect.succeed(foodInAugust),
};
const mastercardLabel = { id: mastercard.id, kind: "card", label: "Mastercard", currency: "AUD" };
// The Mastercard has no records from 11 August 2026.
const mastercardGap = {
  kind: "missingRecords",
  account: mastercardLabel,
  period: { start: "2026-08-11", endExclusive: "2026-09-01" },
};

describe("TurnRunner", () => {
  it.effect(
    "an answer's figure token stands for the amount a tool read, the screen that shows it, and the records behind it",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(turn).toMatchObject({
          status: "answered",
          message: null,
          steps: [{ label: "Reading spending in Food for August 2026", records: foodOnSpending }],
        });
        expect(turn.answer).toEqual({
          text: "Food came to [[f1]] in August 2026.",
          missing: [],
          records: [],
          figures: [
            {
              id: "f1",
              label: "Food, August 2026",
              value: { kind: "money", amount: { currency: "AUD", minor: 98000n }, signed: false },
              basis: "spending",
              calculatedAt: "2026-09-02T01:00:00.000Z",
              modelAmount: { currency: "AUD", minor: 0n },
              records: foodOnSpending,
            },
          ],
          basis: {
            periods: [
              {
                period: { start: "2026-08-01", endExclusive: "2026-09-01" },
                comparison: { start: "2026-07-01", endExclusive: "2026-08-01" },
              },
            ],
            basis: "spending",
            currency: "AUD",
            accounts: [
              {
                account: { id: everyday.id, kind: "deposit", label: "Everyday", currency: "AUD" },
                missing: [],
                reconciled: [{ start: "2026-07-01", endExclusive: "2026-09-01" }],
              },
              {
                account: mastercardLabel,
                missing: [{ start: "2026-08-11", endExclusive: "2026-09-01" }],
                reconciled: [{ start: "2026-07-01", endExclusive: "2026-08-11" }],
              },
            ],
            otherCurrencyAccounts: [
              { id: expect.any(String), kind: "deposit", label: "Travel money", currency: "USD" },
            ],
            calculatedAt: "2026-09-02T01:00:00.000Z",
          },
          limits: [mastercardGap],
          proposals: [],
        });
      }).pipe(
        Effect.provide(
          analystTest(readsFood, [readFood, answer("Food came to [[f1]] in August 2026.")]),
        ),
      ),
  );

  it.effect("a month cited from a series states the days that month's records lack", () =>
    Effect.gen(function* () {
      const july = yield* askAndRun(1);
      expect(july.answer?.basis?.periods).toEqual([
        { period: { start: "2026-07-01", endExclusive: "2026-08-01" }, comparison: null },
      ]);
      expect(july.answer?.limits).toEqual([]);
      const augustTurn = yield* askAndRun(2);
      expect(augustTurn.answer?.basis?.periods).toEqual([
        { period: { start: "2026-08-01", endExclusive: "2026-09-01" }, comparison: null },
      ]);
      expect(augustTurn.answer?.limits).toEqual([mastercardGap]);
    }).pipe(
      Effect.provide(
        analystTest(
          readsFood,
          [0, 1].flatMap((index) => [
            readFood,
            callToolsReading((prompt) =>
              lastResult(ReadSpending, prompt).pipe(
                Effect.map((spending) => [
                  {
                    name: "Answer",
                    params: {
                      text: `Food came to ${spending.months[index]?.amount?.figure} that month.`,
                      missing: [],
                    },
                  },
                ]),
              ),
            ),
          ]),
        ),
      ),
    ),
  );

  it.effect(
    "an answer that writes an amount goes back to the model, and its next answer is kept",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(turn.answer?.text).toBe("Food came to [[f1]] in August 2026.");
        const requests = yield* modelRequests;
        expect(requests).toHaveLength(3);
        expect(requests[2]?.content.at(-1)).toMatchObject({
          role: "tool",
          content: [
            {
              type: "tool-result",
              name: "Answer",
              isFailure: true,
              result: { problems: [expect.stringContaining('"$980.00" writes an amount')] },
            },
          ],
        });
      }).pipe(
        Effect.provide(
          analystTest(readsFood, [
            readFood,
            answer("Food came to $980.00 in August 2026."),
            answer("Food came to [[f1]] in August 2026."),
          ]),
        ),
      ),
  );

  it.effect(
    "what an answer says is missing is checked like its text, and a capability not built becomes a limit",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(turn.answer?.missing).toEqual(["Ironcage does not detect recurring payments yet."]);
        expect(turn.answer?.limits).toContainEqual({ kind: "notBuilt", capability: "recurring" });
        const requests = yield* modelRequests;
        expect(requests[2]?.content.at(-1)).toMatchObject({
          content: [
            {
              name: "Answer",
              isFailure: true,
              result: { problems: [expect.stringContaining('"$1,000.00" writes an amount')] },
            },
          ],
        });
      }).pipe(
        Effect.provide(
          analystTest(readsFood, [
            readFood,
            callTools({
              name: "Answer",
              params: {
                text: "Food came to [[f1]] in August 2026.",
                missing: [{ text: "Purchases over $1,000.00 are not imported.", capability: null }],
              },
            }),
            callTools({
              name: "Answer",
              params: {
                text: "Food came to [[f1]] in August 2026.",
                missing: [
                  {
                    text: "Ironcage does not detect recurring payments yet.",
                    capability: "recurring",
                  },
                ],
              },
            }),
          ]),
        ),
      ),
  );

  it.effect("the reads of one reply are steps in the order the model called them", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(turn.steps.map((step) => step.label)).toEqual([
        "Reading money in and out for August 2026",
        "Reading spending in Food for August 2026",
      ]);
    }).pipe(
      Effect.provide(
        analystTest({ ...readsFood, getPeriodFlow: () => Effect.succeed(flowInAugust) }, [
          callTools(
            { name: "ReadFlow", params: { period: august, comparison: { kind: "previous" } } },
            { name: "ReadSpending", params: foodSpending },
          ),
          answer("I found what you spent on food."),
        ]),
      ),
    ),
  );

  it.effect("an answer in the same reply as a read checks against what that read returned", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(turn.status).toBe("answered");
      expect(yield* modelRequests).toHaveLength(1);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getSpending: () => Effect.yieldNow.pipe(Effect.as(foodInAugust)),
          },
          [
            callTools(
              { name: "ReadSpending", params: foodSpending },
              {
                name: "Answer",
                params: { text: "Food came to [[f1]] in August 2026.", missing: [] },
              },
            ),
          ],
        ),
      ),
    ),
  );

  it.effect(
    "each model call records its usage once, priced with cached tokens at their own rate, and a call without a report records unknown usage",
    () =>
      Effect.gen(function* () {
        yield* askAndRun(1);
        const usage = {
          commandId: expect.any(String),
          task: "analyst",
          model: "@cf/zai-org/glm-5.3-flash",
        };
        // 600,000 uncached input tokens at $0.15, 400,000 cached at $0.03, and 100,000
        // output tokens at $0.50 a million come to $0.152, rounded up to 16 cents.
        expect(yield* recordedUsage).toEqual([
          {
            ...usage,
            inputTokens: 1_000_000n,
            outputTokens: 100_000n,
            cost: { currency: "USD", minor: 16n },
            status: "success",
          },
          { ...usage, inputTokens: null, outputTokens: null, cost: null, status: "success" },
        ]);
      }).pipe(
        Effect.provide(
          analystTest(readsFood, [
            readFood,
            callToolsUnreported({
              name: "Answer",
              params: { text: "Food came to [[f1]] in August 2026.", missing: [] },
            }),
          ]),
        ),
      ),
  );

  it.effect("a turn the allowance refuses ends blocked without calling the model", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(turn).toMatchObject({
        status: "blocked",
        message: "The analyst is off. Turn it on in Settings.",
        answer: null,
      });
      expect(yield* modelRequests).toEqual([]);
      expect(yield* recordedUsage).toEqual([]);
    }).pipe(Effect.provide(analystTest({ getModelAllowance: () => analystOff }))),
  );

  it.effect(
    "a model that never gives an answer it can keep fails the turn after twelve calls",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(turn).toMatchObject({
          status: "failed",
          message:
            "The analyst could not finish an answer with linked figures. Ask again or narrow the question.",
          answer: null,
        });
        expect(yield* modelRequests).toHaveLength(12);
        expect(yield* recordedUsage).toHaveLength(12);
      }).pipe(
        Effect.provide(
          analystTest(
            { getModelAllowance: () => analystOn },
            Array.from({ length: 12 }, () => answer("Food came to $980.00.")),
          ),
        ),
      ),
  );

  it.effect(
    "a turn the alarm starts again records the new attempt's calls beside the first's",
    () =>
      Effect.gen(function* () {
        const conversations = yield* Conversations;
        const { id } = yield* conversations.ask({
          commandId: commandId(1),
          conversationId: null,
          question,
          context: null,
        });
        expect(Exit.isFailure(yield* Effect.exit(fireAlarm))).toBe(true);
        yield* fireAlarm;
        const turn = yield* turnOf(id);
        expect(turn.status).toBe("answered");
        expect(turn.steps.map((step) => step.label)).toEqual([
          "Reading spending in Food for August 2026",
        ]);
        const usage = yield* recordedUsage;
        expect(usage).toHaveLength(3);
      }).pipe(
        Effect.provide(
          analystTest(readsFood, [
            readFood,
            () => Effect.die("The isolate was reset."),
            readFood,
            answer("Food came to [[f1]] in August 2026."),
          ]),
        ),
      ),
  );

  it.effect("an API that fails unavailable ends the turn with its message", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(turn).toMatchObject({
        status: "failed",
        message: "The service could not complete the request. Try again.",
        answer: null,
      });
      expect(yield* modelRequests).toHaveLength(1);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getSpending: () =>
              Effect.fail(
                new FinanceError({
                  kind: "unavailable",
                  message: "The service could not complete the request. Try again.",
                }),
              ),
          },
          [readFood],
        ),
      ),
    ),
  );

  it.effect(
    "a read the API binding cannot complete ends the turn once, without asking the model again",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(turn).toMatchObject({
          status: "failed",
          message: "The analyst could not reach your records. Try again in a few minutes.",
          answer: null,
        });
        expect(yield* modelRequests).toHaveLength(1);
        expect(turn.steps).toEqual([]);
        expect(yield* recordedUsage).toMatchObject([{ status: "success" }]);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              getSpending: () =>
                Effect.fail(new RpcCallError({ method: "getSpending", cause: "Exceeded CPU" })),
            },
            [readFood],
          ),
        ),
      ),
  );

  it.effect("a question about a selection starts from its read, which the answer can cite", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1, { context: { kind: "category", ...foodSpending } });
      expect(turn.status).toBe("answered");
      expect(turn.steps).toEqual([
        { label: "Reading spending in Food for August 2026", records: foodOnSpending },
      ]);
      const [first] = yield* modelRequests;
      expect(first?.content.map((message) => message.role)).toEqual([
        "system",
        "user",
        "assistant",
        "tool",
      ]);
      expect(first?.content.slice(2)).toMatchObject([
        { content: [{ type: "tool-call", name: "ReadSpending", params: foodSpending }] },
        { content: [{ type: "tool-result", name: "ReadSpending", isFailure: false }] },
      ]);
    }).pipe(
      Effect.provide(analystTest(readsFood, [answer("Food came to [[f1]] in August 2026.")])),
    ),
  );

  it.effect("a follow-up reads the earlier answer's values and cannot cite its tokens", () =>
    Effect.gen(function* () {
      yield* askAndRun(1);
      const followUp = "And how did that compare with July?";
      const next = yield* askAndRun(2, {
        question: followUp,
        conversationId: ConversationId.make(commandId(1)),
      });
      expect(next.status).toBe("answered");
      const requests = yield* modelRequests;
      expect(requests[2]?.content.slice(1).map((message) => message.content)).toMatchObject([
        [{ type: "text", text: question }],
        [{ type: "text", text: "Food came to $980.00 in August 2026." }],
        [{ type: "text", text: followUp }],
      ]);
      expect(requests[4]?.content.at(-1)).toMatchObject({
        content: [
          {
            name: "Answer",
            isFailure: true,
            result: {
              problems: ["[[f1]] is not a figure any tool returned in this turn. Cite only those."],
            },
          },
        ],
      });
    }).pipe(
      Effect.provide(
        analystTest(readsFood, [
          readFood,
          answer("Food came to [[f1]] in August 2026."),
          readFood,
          answer("It was [[f1]] again."),
          answer("I could not compare it with July."),
        ]),
      ),
    ),
  );

  it.effect(
    "text the bank printed reaches the model only in its named field, never as an earlier answer's words",
    () =>
      Effect.gen(function* () {
        yield* askAndRun(1);
        yield* askAndRun(2, {
          question: "Anything else?",
          conversationId: ConversationId.make(commandId(1)),
        });
        const listed = yield* lastResult(ListTransactions, yield* modelRequest(1));
        expect(listed.rows[0]?.bankDescription).toBe(unidentified.description);
        const followUp = yield* modelRequest(2);
        expect(JSON.stringify(yield* Schema.encodeEffect(Prompt.Prompt)(followUp))).not.toContain(
          "IGNORE",
        );
        expect(followUp.content.at(-2)?.content).toMatchObject([
          { type: "text", text: "Most of it was a transaction on 12 August 2026." },
        ]);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              listCountedLedger: () => Effect.succeed(unresolvedPage),
            },
            [
              callTools({
                name: "ListTransactions",
                params: {
                  list: { kind: "counted", scope: unresolvedOut, period: august, filter: {} },
                },
              }),
              callToolsReading((prompt) =>
                lastResult(ListTransactions, prompt).pipe(
                  Effect.map((list) => [
                    {
                      name: "Answer",
                      params: { text: `Most of it was ${list.rows[0]?.transaction}.`, missing: [] },
                    },
                  ]),
                ),
              ),
              answer("Nothing else stands out."),
            ],
          ),
        ),
      ),
  );

  it.effect(
    "the model reads today in the settings timezone and the accounts' labels, and never their numbers",
    () =>
      Effect.gen(function* () {
        // 15:00 on 31 August in UTC is already 1 September in Sydney.
        yield* TestClock.setTime(
          DateTime.toEpochMillis(DateTime.makeUnsafe("2026-08-31T15:00:00Z")),
        );
        yield* askAndRun(1, { question: "What was the card purchase on 12 August?" });
        const requests = yield* modelRequests;
        const system = requests[0]?.content[0];
        assert(system?.role === "system");
        expect(system.content).toContain("Today is 1 September 2026 in Australia/Sydney.");
        expect(system.content).toContain("- Everyday, a deposit account\n");
        expect(system.content).toContain("- Mastercard, a card account\n");
        expect(system.content).toContain(
          "- Travel money, a deposit account in USD, which no figure includes",
        );
        const sent = JSON.stringify(
          yield* Schema.encodeEffect(Schema.Array(Prompt.Prompt))(requests),
        );
        for (const number of accountNumbers) expect(sent).not.toContain(number);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              getPosting: () => Effect.succeed(postingDetail),
              getEventForPosting: () => Effect.succeed(unidentifiedEvent),
              getReferenceData: () => Effect.succeed(referenceData),
              listCountedLedger: () => Effect.succeed(unresolvedPage),
            },
            [
              callTools(
                { name: "ReadTransaction", params: { postingId: unidentified.id } },
                {
                  name: "ListTransactions",
                  params: {
                    list: { kind: "counted", scope: unresolvedOut, period: august, filter: {} },
                  },
                },
              ),
              answer("It was a dinner out."),
            ],
          ),
        ),
      ),
  );
});

describe("TurnRunner's model requests", () => {
  const runWithBackoff = Effect.gen(function* () {
    const { id } = yield* (yield* Conversations).ask({
      commandId: commandId(1),
      conversationId: null,
      question,
      context: null,
    });
    const run = yield* Effect.forkChild(fireAlarm);
    yield* TestClock.adjust("1 minute");
    yield* Fiber.join(run);
    return yield* turnOf(id);
  });
  const rateLimited = requestFails(new AiError.RateLimitError({}));
  const providerFailed = requestFails(
    new AiError.InternalProviderError({ description: "HTTP 503" }),
  );

  it.effect("a request that fails is sent again, and its call records usage once", () =>
    Effect.gen(function* () {
      const turn = yield* runWithBackoff;
      expect(turn.status).toBe("answered");
      expect(yield* modelRequests).toHaveLength(3);
      expect(yield* recordedUsage).toMatchObject([{ inputTokens: 1_000_000n, status: "success" }]);
    }).pipe(
      Effect.provide(
        analystTest({ getModelAllowance: () => analystOn }, [
          rateLimited,
          providerFailed,
          answer("I found no spending on food in August."),
        ]),
      ),
    ),
  );

  it.effect("a request that fails three times ends the turn and records unknown usage", () =>
    Effect.gen(function* () {
      const turn = yield* runWithBackoff;
      expect(turn).toMatchObject({
        status: "failed",
        message: "The analyst could not reach the model. Ask again in a few minutes.",
      });
      expect(yield* recordedUsage).toMatchObject([
        { inputTokens: null, outputTokens: null, cost: null, status: "failed" },
      ]);
    }).pipe(
      Effect.provide(
        analystTest({ getModelAllowance: () => analystOn }, [
          rateLimited,
          providerFailed,
          rateLimited,
        ]),
      ),
    ),
  );

  it.effect("a request the gateway turns down is not sent again", () =>
    Effect.gen(function* () {
      const turn = yield* runWithBackoff;
      expect(turn).toMatchObject({
        status: "failed",
        message:
          "The model turned down the analyst's request. Ask the question another way, or in a new conversation.",
      });
      expect(yield* modelRequests).toHaveLength(1);
    }).pipe(
      Effect.provide(
        analystTest({ getModelAllowance: () => analystOn }, [
          requestFails(new AiError.AuthenticationError({ kind: "InvalidKey" })),
        ]),
      ),
    ),
  );

  it.effect("a reply that arrived is never asked for again, even when it cannot be read", () =>
    Effect.gen(function* () {
      const turn = yield* runWithBackoff;
      expect(turn).toMatchObject({
        status: "failed",
        message: "The analyst could not read the model's reply. Ask again.",
      });
      expect(yield* modelRequests).toHaveLength(1);
      expect(yield* recordedUsage).toMatchObject([{ status: "failed" }]);
    }).pipe(
      Effect.provide(
        analystTest({ getModelAllowance: () => analystOn }, [
          callTools({ name: "ReadBudget", params: {} }),
        ]),
      ),
    ),
  );
});
