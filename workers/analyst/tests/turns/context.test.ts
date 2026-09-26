import { describe, expect, it } from "@effect/vitest";
import type { AskContext, TurnStep } from "@repo/contracts/analyst";
import { YearMonth } from "@repo/contracts/finance";
import { Effect } from "effect";

import { analystOn, analystTest, askAndRun } from "../support/analyst.ts";
import {
  flowInAugust,
  food,
  foodInAugust,
  japanTrip,
  postingDetail,
  questionsInAugust,
  referenceData,
  unidentified,
  unidentifiedEvent,
  unresolvedOut,
  unresolvedPage,
  woolworths,
} from "../support/ledger.ts";
import { callTools } from "../support/model.ts";

const august = {
  kind: "months",
  from: YearMonth.make("2026-08"),
  to: YearMonth.make("2026-08"),
} as const;
const previous = { kind: "previous" } as const;
const foodScope = {
  category: { kind: "category", id: food },
  counterparty: { kind: "all" },
} as const;
const reads = {
  getModelAllowance: () => analystOn,
  getSpending: () => Effect.succeed(foodInAugust),
  getPeriodFlow: () => Effect.succeed(flowInAugust),
  getCounterparty: () => Effect.succeed(woolworths),
  getPosting: () => Effect.succeed(postingDetail),
  getEventForPosting: () => Effect.succeed(unidentifiedEvent),
  getReferenceData: () => Effect.succeed(referenceData),
  listCountedLedger: () => Effect.succeed(unresolvedPage),
  summarizeQuestions: () => Effect.succeed(questionsInAugust),
  listQuestions: () => Effect.succeed({ rows: [], nextCursor: null }),
  listImports: () => Effect.succeed({ rows: [], nextCursor: null }),
};

// A question asked about `context`, and the step it starts from before the model is called.
const asked = (about: string, context: AskContext, step: TurnStep) => ({ about, context, step });

describe("readContext", () => {
  for (const { about, context, step } of [
    asked(
      "spending narrowed to a personal event",
      {
        kind: "category",
        period: august,
        comparison: previous,
        ...foodScope,
        personalEventId: japanTrip,
      },
      {
        label: "Reading spending in Food for Japan trip for August 2026",
        records: {
          kind: "spending",
          period: august,
          comparison: previous,
          ...foodScope,
          personalEventId: japanTrip,
        },
      },
    ),
    asked(
      "a counterparty",
      { kind: "counterparty", counterpartyId: woolworths.counterparty.id },
      {
        label: "Reading Woolworths",
        records: { kind: "counterparty", counterpartyId: woolworths.counterparty.id },
      },
    ),
    asked(
      "a transaction",
      { kind: "transaction", postingId: unidentified.id },
      {
        label: "Reading a transaction on 12 August 2026",
        records: { kind: "transaction", postingId: unidentified.id },
      },
    ),
    asked(
      "a spending stream, which opens Spending against the comparison",
      {
        kind: "stream",
        period: august,
        comparison: previous,
        scope: { measure: "spending", ...foodScope },
      },
      {
        label: "Reading spending in Food for August 2026",
        records: { kind: "spending", period: august, comparison: previous, ...foodScope },
      },
    ),
    asked(
      "another stream, which opens the counted ledger",
      { kind: "stream", period: august, comparison: previous, scope: unresolvedOut },
      {
        label: "Listing the records behind Not yet understood in August 2026",
        records: { kind: "countedLedger", scope: unresolvedOut, period: august, filter: {} },
      },
    ),
    asked(
      "a briefing, which first reads its month against the month before",
      { kind: "briefing", month: YearMonth.make("2026-08") },
      {
        label: "Reading money in and out for August 2026",
        records: { kind: "overview", period: august, comparison: previous },
      },
    ),
  ])
    it.effect(`a question about ${about} starts from the read its screen shows`, () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1, { context });
        expect(turn.steps[0]).toEqual(step);
      }).pipe(
        Effect.provide(
          analystTest(reads, [
            callTools({ name: "Answer", params: { text: "Here is what I found.", missing: [] } }),
          ]),
        ),
      ),
    );
});
