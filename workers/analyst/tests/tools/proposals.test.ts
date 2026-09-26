import { describe, expect, it } from "@effect/vitest";
import {
  AllocationId,
  CounterpartyDetail,
  CounterpartyId,
  FinanceError,
} from "@repo/contracts/finance";
import type { AnalystOperation, ApiClient } from "@repo/infra/api";
import { Effect } from "effect";

import { ProposeReferenceDefault, ProposeTransactionChange } from "../../src/tools/proposals.ts";
import { ReadTransaction } from "../../src/tools/transactions.ts";
import { analystOn, analystTest, answerOf, askAndRun } from "../support/analyst.ts";
import {
  dinner,
  dinnerDetail,
  dinnerEvent,
  diningOut,
  groceries,
  housing,
  nonPersonalDinnerImpact,
  referenceData,
  woolworths,
} from "../support/ledger.ts";
import {
  callTools,
  callToolsReading,
  lastFailure,
  lastResult,
  modelRequest,
} from "../support/model.ts";

const reason = "It was on a workday, and you marked dinners like it as work expenses.";
const answer = callTools({
  name: "Answer",
  params: { text: "I proposed a change for you to accept or ignore.", missing: [] },
});
const dinnerReads = {
  getModelAllowance: () => analystOn,
  getPosting: () => Effect.succeed(dinnerDetail),
  getEventForPosting: () => Effect.succeed(dinnerEvent),
  getReferenceData: () => Effect.succeed(referenceData),
};
// A counterparty change as the API previews it: 21 transactions change meaning, and no
// month's totals move.
const counterpartyReads = {
  getModelAllowance: () => analystOn,
  getReferenceData: () => Effect.succeed(referenceData),
  previewCounterpartyChange: ({ change }) =>
    Effect.succeed({ change, eventCount: 21, impacts: [], event: null }),
} satisfies Partial<ApiClient<AnalystOperation>>;
const proposeNonPersonal = callTools({
  name: "ProposeTransactionChange",
  params: { postingId: dinner.id, patch: { nonPersonal: true }, reason },
});
const previewNonPersonal = {
  ...dinnerReads,
  previewCorrection: ({ change }) =>
    Effect.succeed({
      change,
      expectedVersions: [{ eventId: change.eventId, version: 1 }],
      impacts: [nonPersonalDinnerImpact],
    }),
} satisfies Partial<ApiClient<AnalystOperation>>;

describe("ProposeTransactionChange", () => {
  it.effect(
    "a proposal to mark a dinner non-personal keeps its amount and role, and waits with the preview's effect",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        const [proposal] = answerOf(turn).proposals;
        expect(proposal).toEqual({
          id: expect.any(String),
          intent: { kind: "transaction", postingId: dinner.id, patch: { nonPersonal: true } },
          preview: {
            kind: "correction",
            before: dinnerEvent,
            change: {
              eventId: dinnerEvent.id,
              kind: "purchase",
              purchaseOn: null,
              allocations: [
                {
                  id: dinnerEvent.allocations[0].id,
                  role: "purchase",
                  amount: { currency: "AUD", minor: 18600n },
                  categoryId: diningOut,
                  categorySource: "counterparty",
                  nonPersonal: true,
                  tagIds: [],
                  personalEventIds: [],
                },
              ],
            },
            expectedVersions: [{ eventId: dinnerEvent.id, version: 1 }],
            impacts: [nonPersonalDinnerImpact],
          },
          title: "Mark Rockpool on 12 August 2026 ($186.00) as non-personal",
          reason,
          status: "pending",
          commandId: null,
          resolvedAt: null,
        });
        expect(turn.steps).toEqual([
          {
            label: "Previewing a change to Rockpool on 12 August 2026",
            records: { kind: "transaction", postingId: dinner.id },
          },
        ]);
        expect(yield* lastResult(ProposeTransactionChange, yield* modelRequest(1))).toEqual({
          proposalId: proposal?.id,
          title: "Mark Rockpool on 12 August 2026 ($186.00) as non-personal",
        });
      }).pipe(Effect.provide(analystTest(previewNonPersonal, [proposeNonPersonal, answer]))),
  );

  it.effect("a split comes back to the model as a failure, and the answer proposes nothing", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(yield* lastFailure(ProposeTransactionChange, yield* modelRequest(1))).toMatchObject({
        kind: "conflict",
        message: "Open the transaction to change a split.",
      });
      expect(turn.status).toBe("answered");
      expect(answerOf(turn).proposals).toEqual([]);
    }).pipe(
      Effect.provide(
        analystTest(
          {
            ...dinnerReads,
            getEventForPosting: () =>
              Effect.succeed({
                ...dinnerEvent,
                allocations: [
                  { ...dinnerEvent.allocations[0], amount: { currency: "AUD", minor: 9300n } },
                  {
                    ...dinnerEvent.allocations[0],
                    id: AllocationId.make("00000000-0000-4000-8000-a11000000003"),
                    amount: { currency: "AUD", minor: 9300n },
                  },
                ],
              }),
          },
          [proposeNonPersonal, answer],
        ),
      ),
    ),
  );

  it.effect("a reason that writes an amount comes back to the model, and nothing is proposed", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(yield* lastFailure(ProposeTransactionChange, yield* modelRequest(1))).toMatchObject({
        kind: "invalid",
        message:
          'The reason cannot be shown. "$186.00" writes an amount. Cite the figure that holds it instead.',
      });
      expect(answerOf(turn).proposals).toEqual([]);
    }).pipe(
      Effect.provide(
        analystTest(previewNonPersonal, [
          callTools({
            name: "ProposeTransactionChange",
            params: {
              postingId: dinner.id,
              patch: { nonPersonal: true },
              reason: "It takes $186.00 off your spending in August.",
            },
          }),
          answer,
        ]),
      ),
    ),
  );

  it.effect("a figure only the reason cites stays with the answer that shows the reason", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      const [proposal] = answerOf(turn).proposals;
      expect(proposal?.reason).toMatch(/^Dinner for \[\[f\d+\]\] on a workday/);
      expect(answerOf(turn).figures).toEqual([
        expect.objectContaining({
          label: "Rockpool on 12 August 2026",
          value: { kind: "money", amount: { currency: "AUD", minor: -18600n }, signed: false },
        }),
      ]);
    }).pipe(
      Effect.provide(
        analystTest(previewNonPersonal, [
          callTools({ name: "ReadTransaction", params: { postingId: dinner.id } }),
          callToolsReading((prompt) =>
            lastResult(ReadTransaction, prompt).pipe(
              Effect.map((read) => [
                {
                  name: "ProposeTransactionChange",
                  params: {
                    postingId: dinner.id,
                    patch: { nonPersonal: true },
                    reason: `Dinner for ${read.amount.figure} on a workday, like others you marked as work.`,
                  },
                },
                {
                  name: "Answer",
                  params: { text: "I proposed marking the dinner as non-personal.", missing: [] },
                },
              ]),
            ),
          ),
        ]),
      ),
    ),
  );
});

describe("ProposeCounterpartyDefault", () => {
  it.effect(
    "a default proposal changes only the default it names, expects the version it read, and keeps the default it replaces",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(answerOf(turn).proposals).toEqual([
          expect.objectContaining({
            intent: {
              kind: "counterpartyDefault",
              counterpartyId: woolworths.counterparty.id,
              defaultCategoryId: diningOut,
            },
            preview: {
              kind: "counterpartyChange",
              before: { defaultRole: null, defaultCategoryId: groceries },
              change: {
                kind: "update",
                counterpartyId: woolworths.counterparty.id,
                expectedVersion: 1,
                fields: {
                  name: "Woolworths",
                  kind: "business",
                  brand: null,
                  defaultRole: null,
                  defaultCategoryId: diningOut,
                },
              },
              eventCount: 21,
              impacts: [],
              event: null,
            },
            title: "Set the default category to Dining out for Woolworths",
          }),
        ]);
      }).pipe(
        Effect.provide(
          analystTest({ ...counterpartyReads, getCounterparty: () => Effect.succeed(woolworths) }, [
            callTools({
              name: "ProposeCounterpartyDefault",
              params: {
                counterpartyId: woolworths.counterparty.id,
                defaultCategoryId: diningOut,
                reason,
              },
            }),
            answer,
          ]),
        ),
      ),
  );
});

describe("ProposeReferenceDefault", () => {
  // Sam, a person, is paid rent with the reference "Rent August", which the API keys as
  // RENT, and has no default for it yet.
  const sam = {
    ...woolworths,
    counterparty: {
      ...woolworths.counterparty,
      id: CounterpartyId.make("00000000-0000-4000-8000-000000005a31"),
      name: "Sam",
      kind: "person",
      defaultCategoryId: null,
    },
    references: [
      {
        referenceKey: "RENT",
        sample: "Rent August",
        eventCount: 3,
        defaultRole: null,
        defaultCategoryId: null,
        version: null,
      },
    ],
  } satisfies typeof CounterpartyDetail.Type;
  // The API previews a reference default for Sam's three rent payments, and refuses a
  // transfer, since payments to a person cannot be transfers.
  const samReads = {
    ...counterpartyReads,
    getCounterparty: () => Effect.succeed(sam),
    previewCounterpartyChange: ({ change }) =>
      change.kind === "saveReference" && change.defaultRole === "transfer"
        ? Effect.fail(
            new FinanceError({
              kind: "invalid",
              message:
                'Payments to a person cannot be transfers. If Sam is you at another bank, choose "It\'s me, at another bank" to make it your own account.',
            }),
          )
        : Effect.succeed({ change, eventCount: 3, impacts: [], event: null }),
  } satisfies Partial<ApiClient<AnalystOperation>>;
  const proposeRent = (
    defaultRole: "purchase" | "transfer",
    defaultCategoryId: typeof housing | null,
  ) =>
    callTools({
      name: "ProposeReferenceDefault",
      params: {
        counterpartyId: sam.counterparty.id,
        reference: "Rent August",
        defaultRole,
        defaultCategoryId,
        reason,
      },
    });

  it.effect(
    "a reference the model read as printed becomes its key, with the version the counterparty showed",
    () =>
      Effect.gen(function* () {
        const turn = yield* askAndRun(1);
        expect(answerOf(turn).proposals).toEqual([
          expect.objectContaining({
            intent: {
              kind: "referenceDefault",
              counterpartyId: sam.counterparty.id,
              referenceKey: "RENT",
              defaultRole: "purchase",
              defaultCategoryId: housing,
            },
            preview: expect.objectContaining({
              before: { defaultRole: null, defaultCategoryId: null },
              change: {
                kind: "saveReference",
                counterpartyId: sam.counterparty.id,
                referenceKey: "RENT",
                expectedVersion: null,
                defaultRole: "purchase",
                defaultCategoryId: housing,
              },
              eventCount: 3,
            }),
            title: "Set a reference default for Sam: Purchase, Housing",
          }),
        ]);
      }).pipe(Effect.provide(analystTest(samReads, [proposeRent("purchase", housing), answer]))),
  );

  it.effect("a change the API refuses comes back to the model, and nothing is proposed", () =>
    Effect.gen(function* () {
      const turn = yield* askAndRun(1);
      expect(yield* lastFailure(ProposeReferenceDefault, yield* modelRequest(1))).toMatchObject({
        kind: "invalid",
        message: expect.stringMatching(/^Payments to a person cannot be transfers\./),
      });
      expect(turn.status).toBe("answered");
      expect(answerOf(turn).proposals).toEqual([]);
    }).pipe(Effect.provide(analystTest(samReads, [proposeRent("transfer", null), answer]))),
  );
});
