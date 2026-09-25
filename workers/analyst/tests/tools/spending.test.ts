import { describe, expect, it } from "@effect/vitest";
import { FinanceError, YearMonth } from "@repo/contracts/finance";
import { Effect } from "effect";

import { ReadSpending } from "../../src/tools/spending.ts";
import { analystOn, analystTest, askAndRun } from "../support/analyst.ts";
import {
  diningOut,
  diningOutRow,
  food,
  foodInAugust,
  japanTrip,
  referenceData,
} from "../support/ledger.ts";
import {
  callTools,
  callToolsReading,
  lastResult,
  modelRequest,
  modelRequests,
} from "../support/model.ts";

const august = {
  kind: "months",
  from: YearMonth.make("2026-08"),
  to: YearMonth.make("2026-08"),
} as const;
const july = { ...august, from: YearMonth.make("2026-07"), to: YearMonth.make("2026-07") };
const allSpending = { category: { kind: "all" }, counterparty: { kind: "all" } } as const;
const foodSpending = {
  period: august,
  comparison: { kind: "previous" },
  category: { kind: "category", id: food },
  counterparty: { kind: "all" },
} as const;
const readFood = callTools({ name: "ReadSpending", params: foodSpending });
// An answer that cites what the last ReadSpending returned.
const citing = (write: (spending: typeof ReadSpending.successSchema.Type) => string) =>
  callToolsReading((prompt) =>
    lastResult(ReadSpending, prompt).pipe(
      Effect.map((spending) => [
        { name: "Answer", params: { text: write(spending), missing: [] } },
      ]),
    ),
  );

describe("ReadSpending", () => {
  it.effect(
    "a row's figures open the row on Spending, and its comparison's open the month compared",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        const dining = {
          kind: "spending",
          ...foodSpending,
          category: { kind: "category", id: diningOut },
        };
        expect(turn.answer?.figures).toEqual([
          expect.objectContaining({
            label: "Dining out, August 2026",
            value: { kind: "money", amount: { currency: "AUD", minor: 72000n }, signed: false },
            records: dining,
          }),
          expect.objectContaining({
            label: "Dining out, July 2026",
            value: { kind: "money", amount: { currency: "AUD", minor: 41000n }, signed: false },
            records: { ...dining, period: july },
          }),
          expect.objectContaining({
            label: "Dining out, percent change from July 2026 to August 2026",
            value: { kind: "percent", percent: 76, signed: true },
            records: dining,
          }),
        ]);
      }).pipe(
        Effect.provide(
          analystTest(
            { getModelAllowance: () => analystOn, getSpending: () => Effect.succeed(foodInAugust) },
            [
              readFood,
              citing((spending) => {
                const row = spending.rows.find((item) => item.label === "Dining out");
                return `Dining out came to ${row?.figures.amount.figure} in August 2026, up from ${row?.figures.comparison?.amount.figure} in July 2026, ${row?.figures.comparison?.percentChange?.figure}.`;
              }),
            ],
          ),
        ),
      ),
  );

  it.effect("the model reads a view where each figure's value stands beside its token", () =>
    Effect.gen(function* () {
      yield* askAndRun(1);
      const spending = yield* lastResult(ReadSpending, yield* modelRequest(1));
      const dining = spending.rows.find((row) => row.label === "Dining out");
      expect(dining?.figures.amount.value).toBe("$720.00");
      expect(dining?.figures.comparison?.change.value).toBe("+$310.00");
      expect(dining?.figures.comparison?.percentChange?.value).toBe("+76%");
      expect(dining?.share?.value).toBe("73%");
    }).pipe(
      Effect.provide(
        analystTest(
          { getModelAllowance: () => analystOn, getSpending: () => Effect.succeed(foodInAugust) },
          [readFood, callTools({ name: "Answer", params: { text: "Done.", missing: [] } })],
        ),
      ),
    ),
  );

  it.effect("a read the API refuses reaches the model as a failure it can act on", () =>
    Effect.gen(function* () {
      yield* askAndRun(1);
      expect((yield* modelRequests)[1]?.content.at(-1)).toMatchObject({
        role: "tool",
        content: [
          {
            type: "tool-result",
            name: "ReadSpending",
            isFailure: true,
            result: {
              _tag: "FinanceError",
              kind: "notFound",
              message: "This category does not exist.",
            },
          },
        ],
      });
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getSpending: () =>
              Effect.fail(
                new FinanceError({ kind: "notFound", message: "This category does not exist." }),
              ),
          },
          [
            readFood,
            callTools({ name: "Answer", params: { text: "No such category.", missing: [] } }),
          ],
        ),
      ),
    ),
  );

  it.effect("spending for a personal event is named for it, as Spending names it", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1, { question: "How much did the Japan trip cost?" });
      const trip = {
        kind: "spending",
        period: august,
        comparison: { kind: "previous" },
        ...allSpending,
        personalEventId: japanTrip,
      };
      expect(turn.steps).toEqual([
        { label: "Reading spending for Japan trip for August 2026", records: trip },
      ]);
      expect(turn.answer?.figures).toEqual([
        expect.objectContaining({ label: "Spending for Japan trip, August 2026", records: trip }),
      ]);
      const spending = yield* lastResult(ReadSpending, yield* modelRequest(1));
      expect(spending.scope).toEqual(["for Japan trip"]);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getReferenceData: () => Effect.succeed(referenceData),
            getSpending: () =>
              Effect.succeed({
                ...foodInAugust,
                scope: allSpending,
                slug: null,
                path: [],
                rows: [],
              }),
          },
          [
            callTools({
              name: "ReadSpending",
              params: {
                period: august,
                comparison: { kind: "previous" },
                ...allSpending,
                personalEventId: japanTrip,
              },
            }),
            citing(
              (spending) => `The Japan trip cost ${spending.figures.amount.figure} in August 2026.`,
            ),
          ],
        ),
      ),
    ),
  );

  it.effect("an answer may write a name a read returned, digits and all", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(turn.status).toBe("answered");
      expect(yield* modelRequests).toHaveLength(2);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getSpending: () =>
              Effect.succeed({
                ...foodInAugust,
                rows: [{ ...diningOutRow, label: "7-Eleven" }],
              }),
          },
          [
            readFood,
            citing(
              (spending) =>
                `Most of it went to 7-Eleven, ${spending.rows[0]?.figures.amount.figure} in August 2026.`,
            ),
          ],
        ),
      ),
    ),
  );

  it.effect(
    "spending with no category is stated as not understood yet, even when the answer cites another figure",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        const unknown = turn.answer?.figures.find(
          (figure) => figure.label === "Not yet categorised, August 2026",
        );
        expect(unknown?.value).toEqual({
          kind: "money",
          amount: { currency: "AUD", minor: 98000n },
          signed: false,
        });
        expect(turn.answer?.limits).toContainEqual({
          kind: "notUnderstood",
          figureId: unknown?.id,
        });
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              getSpending: () =>
                Effect.succeed({
                  ...foodInAugust,
                  rows: [
                    ...foodInAugust.rows,
                    {
                      label: "Not yet categorised",
                      slug: null,
                      opens: { category: { kind: "uncategorised" }, counterparty: { kind: "all" } },
                      share: null,
                      figures: foodInAugust.figures,
                      months: foodInAugust.months.map((item) => item.amount),
                    },
                  ],
                }),
            },
            [
              readFood,
              citing(
                (spending) => `Food came to ${spending.figures.amount.figure} in August 2026.`,
              ),
            ],
          ),
        ),
      ),
  );
});
