import { describe, expect, it } from "@effect/vitest";
import { YearMonth } from "@repo/contracts/finance";
import { Effect } from "effect";

import { ListTransactions, ReadTransaction } from "../../src/tools/transactions.ts";
import { analystOn, analystTest, askAndRun } from "../support/analyst.ts";
import {
  mastercard,
  postingDetail,
  referenceData,
  unidentified,
  unidentifiedEvent,
  unresolvedOut,
  unresolvedPage,
} from "../support/ledger.ts";
import { callTools, callToolsReading, lastResult } from "../support/model.ts";

const august = {
  kind: "months",
  from: YearMonth.make("2026-08"),
  to: YearMonth.make("2026-08"),
} as const;
const answer = (text: string) => [{ name: "Answer", params: { text, missing: [] } }];

describe("ListTransactions", () => {
  it.effect(
    "a counted list says it shows only its first rows, and each row's counted amount opens the transaction",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        const counted = { kind: "countedLedger", scope: unresolvedOut, period: august, filter: {} };
        expect(turn.steps).toEqual([
          {
            label: "Listing the records behind Not yet understood in August 2026",
            records: counted,
          },
        ]);
        expect(turn.answer?.figures).toEqual([
          expect.objectContaining({
            label: "a transaction on 12 August 2026, counted in Not yet understood",
            value: { kind: "money", amount: { currency: "AUD", minor: -6450n }, signed: false },
            basis: "spending",
            records: { kind: "transaction", postingId: unidentified.id },
          }),
        ]);
        expect(turn.answer?.limits).toEqual([
          {
            kind: "missingRecords",
            account: { id: mastercard.id, kind: "card", label: "Mastercard", currency: "AUD" },
            period: { start: "2026-08-11", endExclusive: "2026-09-01" },
          },
          { kind: "partialList", shown: 1, records: counted },
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
                  Effect.map((list) =>
                    answer(
                      `The card purchase counted ${list.rows[0]?.counted?.figure} in August 2026.`,
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
  );
});

describe("ReadTransaction", () => {
  it.effect("a transaction's amount rests on no period, so the answer states no basis", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(turn.steps.map((step) => step.label)).toEqual([
        "Reading a transaction on 12 August 2026",
      ]);
      expect(turn.answer?.figures).toEqual([
        expect.objectContaining({ label: "a transaction on 12 August 2026", basis: null }),
      ]);
      expect(turn.answer?.basis).toBeNull();
      expect(turn.answer?.records.map((record) => record.label)).toEqual([
        "a transaction on 12 August 2026",
      ]);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            getModelAllowance: () => analystOn,
            getPosting: () => Effect.succeed(postingDetail),
            getEventForPosting: () => Effect.succeed(unidentifiedEvent),
            getReferenceData: () => Effect.succeed(referenceData),
          },
          [
            callTools({ name: "ReadTransaction", params: { postingId: unidentified.id } }),
            callToolsReading((prompt) =>
              lastResult(ReadTransaction, prompt).pipe(
                Effect.map((read) =>
                  answer(`${read.transaction} came to ${read.amount.figure} on 12 August 2026.`),
                ),
              ),
            ),
          ],
        ),
      ),
    ),
  );
});
