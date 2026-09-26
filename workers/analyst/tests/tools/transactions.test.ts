import { describe, expect, it } from "@effect/vitest";
import { type LedgerPage, type ListPostings, YearMonth } from "@repo/contracts/finance";
import { Effect, Ref } from "effect";

import { ListTransactions, ReadTransaction } from "../../src/tools/transactions.ts";
import { analystOn, analystTest, askAndRun } from "../support/analyst.ts";
import {
  dinner,
  dinnerEvent,
  diningOut,
  mastercard,
  postingDetail,
  referenceData,
  rockpool,
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

describe("ListTransactions of the ledger", () => {
  // The dinner at Rockpool, then more payments to Rockpool on the next page.
  const toRockpool = {
    rows: [
      {
        ...dinner,
        eventId: dinnerEvent.id,
        role: "purchase",
        counterpartyId: rockpool,
        counterpartyName: "Rockpool",
        categoryId: diningOut,
        categoryName: "Dining out",
        categorySlug: "food.dining-out",
        split: false,
        assignedBy: "bank",
        question: false,
      },
    ],
    nextCursor: { postedOn: dinner.postedOn, id: dinner.id },
  } satisfies typeof LedgerPage.Type;
  const read = Ref.makeUnsafe<ReadonlyArray<typeof ListPostings.Type>>([]);

  it.effect(
    "a posting list reads every day of the months it names, and its links open those days",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        const listed = {
          kind: "postingLedger",
          period: august,
          filter: { counterpartyId: rockpool },
        } as const;
        expect(yield* Ref.get(read)).toEqual([
          { filter: { counterpartyId: rockpool, from: "2026-08-01", to: "2026-08-31" } },
        ]);
        expect(turn.steps).toEqual([
          { label: "Listing transactions in the ledger in August 2026", records: listed },
        ]);
        expect(turn.answer?.limits).toEqual([{ kind: "partialList", shown: 1, records: listed }]);
      }).pipe(
        Effect.provide(
          analystTest(
            {
              getModelAllowance: () => analystOn,
              listLedger: (input) =>
                Ref.update(read, (inputs) => [...inputs, input]).pipe(Effect.as(toRockpool)),
            },
            [
              callTools({
                name: "ListTransactions",
                params: {
                  list: { kind: "ledger", period: august, filter: { counterpartyId: rockpool } },
                },
              }),
              callTools(...answer("I listed the payments to Rockpool.")),
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
