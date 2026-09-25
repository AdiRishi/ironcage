import { describe, expect, it } from "@effect/vitest";
import { YearMonth } from "@repo/contracts/finance";
import { Effect } from "effect";

import { ReadFlow, ReadMonths } from "../../src/tools/flow.ts";
import { analystOn, analystTest, askAndRun } from "../support/analyst.ts";
import { flowInAugust, mastercard } from "../support/ledger.ts";
import { callTools, callToolsReading, lastResult, modelRequest } from "../support/model.ts";

const month = (value: string) =>
  ({ kind: "months", from: YearMonth.make(value), to: YearMonth.make(value) }) as const;
const august = month("2026-08");
const readFlow = callTools({
  name: "ReadFlow",
  params: { period: august, comparison: { kind: "previous" } },
});
const citingFlow = (write: (flow: typeof ReadFlow.successSchema.Type) => string) =>
  callToolsReading((prompt) =>
    lastResult(ReadFlow, prompt).pipe(
      Effect.map((flow) => [{ name: "Answer", params: { text: write(flow), missing: [] } }]),
    ),
  );
const aud = (minor: bigint) => ({ currency: "AUD", minor });
const mastercardGap = {
  kind: "missingRecords",
  account: { id: mastercard.id, kind: "card", label: "Mastercard", currency: "AUD" },
  period: { start: "2026-08-11", endExclusive: "2026-09-01" },
};

describe("ReadFlow", () => {
  it.effect(
    "money not yet understood is stated beside every answer, and the model's share only beside the spending it cites",
    () =>
      Effect.gen(function* () {
        const spending = yield* askAndRun(1);
        const cameIn = yield* askAndRun(2);
        const figureNamed = (turn: typeof spending, label: string) =>
          turn.answer?.figures.find((figure) => figure.label === label);
        const unknown = figureNamed(spending, "Not yet understood, August 2026");
        const spent = figureNamed(spending, "Spending, August 2026");
        expect(unknown?.value).toMatchObject({ amount: aud(70000n) });
        expect(spent?.modelAmount).toEqual(aud(12000n));
        expect(spending.answer?.limits).toEqual(
          expect.arrayContaining([
            { kind: "notUnderstood", figureId: unknown?.id },
            { kind: "modelShare", figureId: spent?.id },
          ]),
        );
        expect(cameIn.answer?.limits.map((limit) => limit.kind)).toEqual([
          "missingRecords",
          "notUnderstood",
        ]);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              getPeriodFlow: () => Effect.succeed(flowInAugust),
            },
            [
              readFlow,
              citingFlow((flow) => `You spent ${flow.spending.amount.figure} in August 2026.`),
              readFlow,
              citingFlow((flow) => `${flow.cameIn.amount.figure} came in during August 2026.`),
            ],
          ),
        ),
      ),
  );

  it.effect(
    "what came in during the month compared opens the overview for that month, where it shows",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        const cited = turn.answer?.figures.filter((figure) => figure.label.startsWith("Came in"));
        expect(cited?.map(({ label, value, records }) => ({ label, value, records }))).toEqual([
          {
            label: "Came in, July 2026",
            value: { kind: "money", amount: aud(850000n), signed: false },
            records: {
              kind: "overview",
              period: month("2026-07"),
              comparison: { kind: "previous" },
            },
          },
          {
            label: "Came in, change from July 2026 to August 2026",
            value: { kind: "money", amount: aud(0n), signed: true },
            records: { kind: "overview", period: august, comparison: { kind: "previous" } },
          },
        ]);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              getPeriodFlow: () => Effect.succeed(flowInAugust),
            },
            [
              readFlow,
              citingFlow(
                (flow) =>
                  `${flow.cameIn.comparison?.amount.figure} came in during July 2026, a change of ${flow.cameIn.comparison?.change.figure} in August 2026.`,
              ),
            ],
          ),
        ),
      ),
  );

  it.effect("a comparison period without records gives no comparison figures", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      const flow = yield* lastResult(ReadFlow, yield* modelRequest(1));
      expect([
        flow.cameIn.comparison,
        flow.wentOut.comparison,
        flow.spending.comparison,
        flow.spending.percentChange,
      ]).toEqual([null, null, null, null]);
      expect(flow.streams.map((stream) => [stream.comparison, stream.percentChange])).toEqual([
        [null, null],
        [null, null],
        [null, null],
        [null, null],
      ]);
      expect(flow.leftOver?.value).toBe("$5,400.00");
      expect(flow.shortBy).toBeNull();
      expect(turn.answer?.basis?.periods).toEqual([
        { period: { start: "2026-08-01", endExclusive: "2026-09-01" }, comparison: null },
      ]);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getPeriodFlow: () =>
              Effect.succeed({
                ...flowInAugust,
                comparisonCoverage: { state: "missing", gaps: [] },
              }),
          },
          [
            readFlow,
            citingFlow((flow) => `${flow.cameIn.amount.figure} came in during August 2026.`),
          ],
        ),
      ),
    ),
  );
});

describe("ReadMonths", () => {
  it.effect(
    "a month's spending opens Spending for that month, and a month missing records says which days",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(turn.answer?.figures).toEqual([
          expect.objectContaining({
            label: "Spending, August 2026",
            modelAmount: aud(12000n),
            records: {
              kind: "spending",
              period: august,
              comparison: { kind: "previous" },
              category: { kind: "all" },
              counterparty: { kind: "all" },
            },
          }),
        ]);
        expect(turn.answer?.basis?.periods).toEqual([
          { period: { start: "2026-08-01", endExclusive: "2026-09-01" }, comparison: null },
        ]);
        expect(turn.answer?.limits).toEqual([
          mastercardGap,
          { kind: "modelShare", figureId: turn.answer?.figures[0]?.id },
        ]);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              getMonthlyFlow: () =>
                Effect.succeed([
                  {
                    month: YearMonth.make("2026-07"),
                    inflow: aud(850000n),
                    outflow: aud(280000n),
                    spending: aud(230000n),
                    modelShare: aud(0n),
                    coverage: "complete",
                  },
                  {
                    month: YearMonth.make("2026-08"),
                    inflow: aud(850000n),
                    outflow: aud(310000n),
                    spending: aud(240000n),
                    modelShare: aud(12000n),
                    coverage: "partial",
                  },
                ]),
            },
            [
              callTools({ name: "ReadMonths", params: {} }),
              callToolsReading((prompt) =>
                lastResult(ReadMonths, prompt).pipe(
                  Effect.map((read) => [
                    {
                      name: "Answer",
                      params: {
                        text: `You spent ${read.months[1]?.spending?.figure} in August 2026.`,
                        missing: [],
                      },
                    },
                  ]),
                ),
              ),
            ],
          ),
        ),
      ),
  );
});
