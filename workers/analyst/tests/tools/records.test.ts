import { describe, expect, it } from "@effect/vitest";
import { type Import, ImportId, SourceFileId, YearMonth } from "@repo/contracts/finance";
import { Effect } from "effect";

import { ReadFlow } from "../../src/tools/flow.ts";
import { ReadCoverage } from "../../src/tools/records.ts";
import { analystOn, analystTest, answerOf, askAndRun } from "../support/analyst.ts";
import { flowInAugust, mastercard } from "../support/ledger.ts";
import { callTools, callToolsReading, lastResult, modelRequest } from "../support/model.ts";

const august = {
  kind: "months",
  from: YearMonth.make("2026-08"),
  to: YearMonth.make("2026-08"),
} as const;
const upload = (n: number, fileName: string, status: Import["status"], failure: string | null) =>
  ({
    id: ImportId.make(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
    sourceFileId: SourceFileId.make(`00000000-0000-4000-8000-${String(n).padStart(12, "f")}`),
    accountId: mastercard.id,
    fileName,
    format: "pdf",
    status,
    summary: null,
    failure: failure === null ? null : { message: failure },
    version: 1,
    createdAt: `2026-0${n}-01T00:00:00.000Z`,
  }) satisfies Import;
const mastercardGap = {
  kind: "missingRecords",
  account: { id: mastercard.id, kind: "card", label: "Mastercard", currency: "AUD" },
  period: { start: "2026-08-11", endExclusive: "2026-09-01" },
};

describe("ReadCoverage", () => {
  it.effect(
    "a check of a period's records reads every page of imports, and the answer states the days it found missing",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1, { question: "Are my August records complete?" });
        const coverage = yield* lastResult(ReadCoverage, yield* modelRequest(1));
        expect(coverage.imports).toEqual([
          {
            file: "Mastercard March 2026.pdf",
            status: "failed",
            problem: "The statement could not be read.",
          },
        ]);
        expect(answerOf(turn).basis?.periods).toEqual([
          { period: { start: "2026-08-01", endExclusive: "2026-09-01" }, comparison: null },
        ]);
        expect(answerOf(turn).limits).toEqual([mastercardGap]);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              listImports: (input) =>
                Effect.succeed(
                  input?.cursor === undefined
                    ? {
                        rows: [upload(8, "Mastercard August 2026.pdf", "complete", null)],
                        nextCursor: {
                          createdAt: "2026-08-01T00:00:00.000Z",
                          id: "00000000-0000-4000-8000-000000000008",
                        },
                      }
                    : {
                        rows: [
                          upload(
                            3,
                            "Mastercard March 2026.pdf",
                            "failed",
                            "The statement could not be read.",
                          ),
                        ],
                        nextCursor: null,
                      },
                ),
            },
            [
              callTools({ name: "ReadCoverage", params: { period: august } }),
              callTools({
                name: "Answer",
                params: { text: "The Mastercard has no records from 11 August 2026.", missing: [] },
              }),
            ],
          ),
        ),
      ),
  );

  it.effect("a period checked and read against a comparison is named once, with it", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(answerOf(turn).basis?.periods).toEqual([
        {
          period: { start: "2026-08-01", endExclusive: "2026-09-01" },
          comparison: { start: "2026-07-01", endExclusive: "2026-08-01" },
        },
      ]);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getPeriodFlow: () => Effect.succeed(flowInAugust),
            listImports: () => Effect.succeed({ rows: [], nextCursor: null }),
          },
          [
            callTools(
              { name: "ReadFlow", params: { period: august, comparison: { kind: "previous" } } },
              { name: "ReadCoverage", params: { period: august } },
            ),
            callToolsReading((prompt) =>
              lastResult(ReadFlow, prompt).pipe(
                Effect.map((flow) => [
                  {
                    name: "Answer",
                    params: {
                      text: `${flow.cameIn.amount.figure} came in during August 2026.`,
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
