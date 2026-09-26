import { describe, expect, it } from "@effect/vitest";
import type { ConversationId } from "@repo/contracts/analyst";
import type { FinancialEvent } from "@repo/contracts/finance";
import { Effect, Ref } from "effect";
import { TestClock } from "effect/testing";

import { Conversations } from "../../src/conversations/service.ts";
import { Proposals } from "../../src/proposals/service.ts";
import {
  analystOn,
  analystTest,
  commandId,
  fireAlarm,
  question,
  turnOf,
} from "../support/analyst.ts";
import {
  dinner,
  dinnerDetail,
  dinnerEvent,
  groceries,
  nonPersonalDinnerImpact,
  referenceData,
} from "../support/ledger.ts";
import { callTools } from "../support/model.ts";

// The dinner as the API reads it now. A test changes it to stand for an edit made after
// the analyst proposed marking it non-personal.
const stored = Ref.makeUnsafe<FinancialEvent>(dinnerEvent);
const proposing = analystTest(
  {
    getModelAllowance: () => analystOn,
    getPosting: () => Effect.succeed(dinnerDetail),
    getEventForPosting: () => Ref.get(stored),
    getReferenceData: () => Effect.succeed(referenceData),
    previewCorrection: ({ change }) =>
      Ref.get(stored).pipe(
        Effect.map((event) => ({
          change,
          expectedVersions: [{ eventId: event.id, version: event.version }],
          impacts: [nonPersonalDinnerImpact],
        })),
      ),
  },
  [
    callTools({
      name: "ProposeTransactionChange",
      params: {
        postingId: dinner.id,
        patch: { nonPersonal: true },
        reason: "It was on a workday, and you marked dinners like it as work expenses.",
      },
    }),
    callTools({
      name: "Answer",
      params: { text: "I proposed marking the dinner as non-personal.", missing: [] },
    }),
  ],
);

// The one proposal in a conversation's last answer, as the analyst screen shows it.
const shown = Effect.fn("shown")(function* (conversationId: ConversationId) {
  const [proposal] = (yield* turnOf(conversationId)).answer?.proposals ?? [];
  if (!proposal) return yield* Effect.die("The turn proposed nothing.");
  return proposal;
});
const proposed = Effect.gen(function* () {
  yield* Ref.set(stored, dinnerEvent);
  const { id } = yield* (yield* Conversations).ask({
    commandId: commandId(1),
    conversationId: null,
    question,
    context: null,
  });
  yield* fireAlarm;
  return { conversationId: id, proposalId: (yield* shown(id)).id };
});

describe("Proposals", () => {
  it.effect(
    "accepting again with the same command changes nothing, and an accepted proposal stays accepted",
    () =>
      Effect.gen(function* () {
        const proposals = yield* Proposals;
        const { conversationId, proposalId } = yield* proposed;
        const accept = { kind: "accepted", commandId: commandId(2) } as const;
        const accepted = yield* proposals.resolve({ proposalId, outcome: accept });
        expect(accepted).toMatchObject({
          status: "accepted",
          commandId: commandId(2),
          resolvedAt: "1970-01-01T00:00:00.000Z",
        });

        yield* TestClock.adjust("1 hour");
        expect(yield* proposals.resolve({ proposalId, outcome: accept })).toEqual(accepted);
        for (const refused of [
          proposals.resolve({ proposalId, outcome: { kind: "ignored" } }),
          proposals.resolve({ proposalId, outcome: { kind: "accepted", commandId: commandId(3) } }),
          proposals.refresh({ proposalId }),
        ])
          expect(yield* Effect.flip(refused)).toMatchObject({
            kind: "conflict",
            message: "You already accepted this change.",
          });
        expect(yield* shown(conversationId)).toEqual(accepted);
      }).pipe(Effect.provide(proposing)),
  );

  it.effect("ignoring twice keeps the time it was first ignored", () =>
    Effect.gen(function* () {
      const proposals = yield* Proposals;
      const { proposalId } = yield* proposed;
      const ignored = yield* proposals.resolve({ proposalId, outcome: { kind: "ignored" } });
      yield* TestClock.adjust("1 hour");
      expect(yield* proposals.resolve({ proposalId, outcome: { kind: "ignored" } })).toEqual(
        ignored,
      );
      expect(ignored).toMatchObject({ status: "ignored", resolvedAt: "1970-01-01T00:00:00.000Z" });
    }).pipe(Effect.provide(proposing)),
  );

  it.effect(
    "Preview again after the dinner changed previews the change on the dinner as it is now",
    () =>
      Effect.gen(function* () {
        const proposals = yield* Proposals;
        const { conversationId, proposalId } = yield* proposed;
        const [allocation] = dinnerEvent.allocations;
        // You moved the dinner to Groceries after the analyst proposed the change.
        const edited = {
          ...dinnerEvent,
          version: 2,
          allocations: [{ ...allocation, categoryId: groceries, categorySource: "user" }],
        } satisfies FinancialEvent;
        yield* Ref.set(stored, edited);
        expect(yield* proposals.resolve({ proposalId, outcome: { kind: "stale" } })).toMatchObject({
          status: "stale",
          resolvedAt: null,
        });

        const refreshed = yield* proposals.refresh({ proposalId });
        expect(refreshed).toMatchObject({
          status: "pending",
          title: "Mark Rockpool on 12 August 2026 ($186.00) as non-personal",
          preview: {
            kind: "correction",
            before: edited,
            change: {
              allocations: [
                {
                  ...allocation,
                  categoryId: groceries,
                  categorySource: "user",
                  nonPersonal: true,
                },
              ],
            },
            expectedVersions: [{ eventId: dinnerEvent.id, version: 2 }],
          },
        });
        expect(yield* shown(conversationId)).toEqual(refreshed);
      }).pipe(Effect.provide(proposing)),
  );
});
