import {
  type Conversation,
  ConversationId,
  type Proposal,
  ProposalId,
  ResolveProposal,
  TurnId,
} from "@repo/contracts/analyst";
import {
  AccountId,
  AllocationId,
  ApplyCorrection,
  ApplyCounterpartyChange,
  CalendarDate,
  CategoryId,
  type Counterparty,
  CounterpartyChangeId,
  type CounterpartyChangeOutcome,
  CounterpartyId,
  EventId,
  type FinancialEvent,
  Instant,
  type MeasureImpact,
  PostingId,
} from "@repo/contracts/finance";
import { patchEvent } from "@repo/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Effect, Result, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ConversationView } from "@/features/analyst/conversation";
import {
  ask,
  getBriefing,
  getConversation,
  listBriefings,
  listConversations,
  refreshProposal,
  requestBriefing,
  resolveProposal,
} from "@/features/analyst/functions";
import { conversationQuery } from "@/features/analyst/queries";
import { applyCounterpartyChange } from "@/features/counterparties/functions";
import {
  applyCorrection,
  getEventForPosting,
  getEventHistory,
  getReferenceData,
} from "@/features/events/functions";
import { getPosting, listCountedLedger, listLedger } from "@/features/ledger/functions";
import { getRetention, getSettings } from "@/features/settings/functions";
import { AppRequestError } from "@/lib/app-error";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/analyst/functions", () => ({
  ask: vi.fn<typeof ask>(),
  getBriefing: vi.fn<typeof getBriefing>(),
  getConversation: vi.fn<typeof getConversation>(),
  listBriefings: vi.fn<typeof listBriefings>(),
  listConversations: vi.fn<typeof listConversations>(),
  refreshProposal: vi.fn<typeof refreshProposal>(),
  requestBriefing: vi.fn<typeof requestBriefing>(),
  resolveProposal: vi.fn<typeof resolveProposal>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/counterparties/functions", () => ({
  applyCounterpartyChange: vi.fn<typeof applyCounterpartyChange>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  applyCorrection: vi.fn<typeof applyCorrection>(),
  getEventForPosting: vi.fn<typeof getEventForPosting>(),
  getEventHistory: vi.fn<typeof getEventHistory>(),
  getReferenceData: vi.fn<typeof getReferenceData>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/ledger/functions", () => ({
  getPosting: vi.fn<typeof getPosting>(),
  listCountedLedger: vi.fn<typeof listCountedLedger>(),
  listLedger: vi.fn<typeof listLedger>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/settings/functions", () => ({
  getRetention: vi.fn<typeof getRetention>(),
  getSettings: vi.fn<typeof getSettings>(),
}));

const conversationId = ConversationId.make("00000000-0000-4000-8000-0000000000c1");
const proposalId = ProposalId.make("00000000-0000-4000-8000-0000000000b1");
const diningOut = CategoryId.make("00000000-0000-4000-8000-0000000000d0");
const groceries = CategoryId.make("00000000-0000-4000-8000-0000000000d1");
const housing = CategoryId.make("00000000-0000-4000-8000-0000000000d2");
const woolworthsId = CounterpartyId.make("00000000-0000-4000-8000-0000000000c3");
const samId = CounterpartyId.make("00000000-0000-4000-8000-0000000000c4");
const postingId = PostingId.make("00000000-0000-4000-8000-0000000000f1");
const aud = (minor: bigint) => ({ currency: "AUD", minor });
const askedAt = Instant.make("2026-09-25T06:30:00.000Z");
// Mid-morning on 26 September in Sydney.
const acceptedAt = Instant.make("2026-09-26T01:00:00.000Z");

// A $186.00 dinner at Rockpool on 12 August 2026, in Dining out by Rockpool's default.
const dinner = {
  id: EventId.make("00000000-0000-4000-8000-0000000000e7"),
  kind: "purchase",
  roleSource: "bank",
  counterpartyId: CounterpartyId.make("00000000-0000-4000-8000-0000000000c2"),
  counterpartySource: "alias",
  magnitude: aud(18600n),
  primaryPostingId: postingId,
  reportingAccountId: AccountId.make("00000000-0000-4000-8000-0000000000a0"),
  purchaseOn: null,
  active: true,
  version: 1,
  allocations: [
    {
      id: AllocationId.make("00000000-0000-4000-8000-0000000000a1"),
      role: "purchase",
      amount: aud(18600n),
      categoryId: diningOut,
      categorySource: "counterparty",
      nonPersonal: false,
      tagIds: [],
      personalEventIds: [],
    },
  ],
  postings: [],
} satisfies FinancialEvent;

const measures = (spending: bigint) => ({
  inflow: aud(850000n),
  outflow: aud(310000n),
  spending: aud(spending),
  income: aud(850000n),
  internal: aud(0n),
  loanPrincipal: aud(0n),
  unresolvedOut: aud(0n),
  unresolvedIn: aud(0n),
  modelShare: aud(0n),
});
// August's spending falls by the dinner's $186.00 once it is non-personal.
const august: typeof MeasureImpact.Type = {
  start: CalendarDate.make("2026-08-01"),
  endExclusive: CalendarDate.make("2026-09-01"),
  basis: "spending",
  currency: "AUD",
  calculatedAt: askedAt,
  before: measures(240000n),
  after: measures(221400n),
};

// The analyst's proposal to mark the dinner non-personal, previewed against `event`.
const previewed = (event: FinancialEvent): Proposal => ({
  id: proposalId,
  intent: { kind: "transaction", postingId, patch: { nonPersonal: true } },
  preview: {
    kind: "correction",
    before: event,
    change: Result.getOrThrow(patchEvent(event, { nonPersonal: true })),
    expectedVersions: [{ eventId: event.id, version: event.version }],
    impacts: [august],
  },
  title: "Mark Rockpool on 12 August 2026 ($186.00) as non-personal",
  reason,
  status: "pending",
  commandId: null,
  resolvedAt: null,
});

const reason = "It was on a workday, and you marked dinners like it as work expenses.";

// Woolworths at version 1, with Groceries as its default category.
const woolworthsAtFirst: Counterparty = {
  id: woolworthsId,
  name: "Woolworths",
  kind: "business",
  brand: null,
  defaultCategoryId: groceries,
  defaultRole: null,
  source: "user",
  status: "applied",
  model: null,
  confidence: null,
  reason: null,
  version: 1,
  updatedAt: askedAt,
};
// The analyst's proposal to make Dining out Woolworths' default category, previewed at
// version 1: 21 transactions change meaning, and no month's totals move.
const diningOutDefault: Proposal = {
  id: proposalId,
  intent: {
    kind: "counterpartyDefault",
    counterpartyId: woolworthsId,
    defaultCategoryId: diningOut,
  },
  preview: {
    kind: "counterpartyChange",
    before: { defaultRole: null, defaultCategoryId: groceries },
    change: {
      kind: "update",
      counterpartyId: woolworthsId,
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
  reason,
  status: "pending",
  commandId: null,
  resolvedAt: null,
};
// The analyst's proposal that Sam's three payments marked RENT are purchases in Housing,
// where they followed Sam's defaults before.
const rentDefault: Proposal = {
  id: proposalId,
  intent: {
    kind: "referenceDefault",
    counterpartyId: samId,
    referenceKey: "RENT",
    defaultRole: "purchase",
    defaultCategoryId: housing,
  },
  preview: {
    kind: "counterpartyChange",
    before: { defaultRole: null, defaultCategoryId: null },
    change: {
      kind: "saveReference",
      counterpartyId: samId,
      referenceKey: "RENT",
      expectedVersion: null,
      defaultRole: "purchase",
      defaultCategoryId: housing,
    },
    eventCount: 3,
    impacts: [],
    event: null,
  },
  title: "Set a reference default for Sam: Purchase, Housing",
  reason,
  status: "pending",
  commandId: null,
  resolvedAt: null,
};

// The API and the analyst as far as these tests go. The dinner and Woolworths keep a
// version that every change checks, a repeated command returns what it first did, and
// the analyst keeps the proposal, which can be accepted only with a command that applied
// it. Preview again fails as the analyst does when the change would leave the dinner as
// it is.
let event: FinancialEvent;
let woolworths: Counterparty;
let proposal: Proposal;
let corrected: Map<string, FinancialEvent>;
let changed: Map<string, typeof CounterpartyChangeOutcome.Type>;
function serve(proposed: Proposal = previewed(dinner)) {
  event = dinner;
  woolworths = woolworthsAtFirst;
  proposal = proposed;
  corrected = new Map();
  changed = new Map();
  vi.mocked(getSettings).mockResolvedValue({
    timezone: "Australia/Sydney",
    reportingCurrency: "AUD",
    version: 1,
  });
  vi.mocked(getReferenceData).mockResolvedValue({
    categories: [
      {
        id: diningOut,
        parentId: null,
        name: "Dining out",
        slug: "food.dining",
        tree: "spending",
        position: 1,
        archived: false,
        version: 1,
      },
      {
        id: groceries,
        parentId: null,
        name: "Groceries",
        slug: "food.groceries",
        tree: "spending",
        position: 2,
        archived: false,
        version: 1,
      },
      {
        id: housing,
        parentId: null,
        name: "Housing",
        slug: "housing",
        tree: "spending",
        position: 3,
        archived: false,
        version: 1,
      },
    ],
    counterparties: [],
    tags: [],
    personalEvents: [],
  });
  vi.mocked(listConversations).mockResolvedValue({ rows: [], nextCursor: null });
  vi.mocked(getConversation).mockImplementation(async (): Promise<Conversation> => ({
    id: conversationId,
    title: "Was the Rockpool dinner a work expense?",
    turns: [
      {
        id: TurnId.make("00000000-0000-4000-8000-0000000000e1"),
        question: "Was the Rockpool dinner a work expense?",
        context: null,
        status: "answered",
        steps: [],
        answer: {
          text: "I proposed marking the dinner as non-personal.",
          missing: [],
          figures: [],
          records: [],
          basis: null,
          limits: [],
          proposals: [proposal],
        },
        askedAt,
        finishedAt: askedAt,
      },
    ],
  }));
  vi.mocked(applyCorrection).mockImplementation(async ({ data }) => {
    const input = await Effect.runPromise(Schema.decodeEffect(ApplyCorrection)(data));
    const repeated = corrected.get(input.commandId);
    if (repeated) return repeated;
    if (input.expectedVersions.some(({ version }) => version !== event.version))
      throw new AppRequestError("stale", "This transaction changed. Review it and save again.");
    event = {
      ...event,
      kind: input.change.kind,
      purchaseOn: input.change.purchaseOn,
      allocations: input.change.allocations,
      version: event.version + 1,
    };
    corrected.set(input.commandId, event);
    return event;
  });
  vi.mocked(applyCounterpartyChange).mockImplementation(async ({ data }) => {
    const { commandId, change } = await Effect.runPromise(
      Schema.decodeEffect(ApplyCounterpartyChange)(data),
    );
    const repeated = changed.get(commandId);
    if (repeated) return repeated;
    if (change.kind !== "update") throw new Error("These tests accept only a default.");
    if (change.expectedVersion !== woolworths.version)
      throw new AppRequestError("stale", "This counterparty changed. Review it and save again.");
    woolworths = { ...woolworths, ...change.fields, version: woolworths.version + 1 };
    const outcome = {
      changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c9"),
      counterparty: woolworths,
    };
    changed.set(commandId, outcome);
    return outcome;
  });
  vi.mocked(resolveProposal).mockImplementation(async ({ data }) => {
    const { outcome } = await Effect.runPromise(Schema.decodeEffect(ResolveProposal)(data));
    if (
      outcome.kind === "accepted" &&
      !corrected.has(outcome.commandId) &&
      !changed.has(outcome.commandId)
    )
      throw new AppRequestError("invalid", "No command applied this proposal.");
    proposal = {
      ...proposal,
      status: outcome.kind,
      commandId: outcome.kind === "accepted" ? outcome.commandId : null,
      resolvedAt: outcome.kind === "stale" ? null : acceptedAt,
    };
    return proposal;
  });
  vi.mocked(refreshProposal).mockImplementation(async () => {
    if (event.allocations.every((allocation) => allocation.nonPersonal))
      throw new AppRequestError(
        "invalid",
        "This change leaves Rockpool on 12 August 2026 as it is.",
      );
    proposal = previewed(event);
    return proposal;
  });
}

async function renderConversation(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const root = createRootRoute();
  const open = createRoute({
    getParentRoute: () => root,
    path: "/analyst/$conversationId",
    component: function Open() {
      const { data } = useSuspenseQuery(conversationQuery(conversationId));
      return <ConversationView conversation={data} enabled />;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([open]),
    history: createMemoryHistory({ initialEntries: [`/analyst/${conversationId}`] }),
  });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    for (const fn of [
      getConversation,
      listConversations,
      resolveProposal,
      refreshProposal,
      applyCorrection,
      applyCounterpartyChange,
      getReferenceData,
      getSettings,
    ])
      vi.mocked(fn).mockReset();
  });
}

const card = (title = "Mark Rockpool on 12 August 2026 ($186.00) as non-personal") =>
  page.getByRole("region", { name: title });

test("Accept applies the change at the version it was previewed at, then says when it was accepted", async ({
  onTestFinished,
}) => {
  serve();
  await renderConversation(onTestFinished);

  await expect
    .element(card().getByRole("row", { name: /^Non-personal portion/ }))
    .toHaveTextContent("Non-personal portionNoYes");
  await expect
    .element(card().getByRole("heading", { level: 5, name: "Effect on August 2026" }))
    .toBeVisible();
  await card().getByRole("button", { name: "Accept" }).click();

  await expect
    .element(card().getByText(/^Accepted 26 September 2026\./))
    .toHaveTextContent("Accepted 26 September 2026. Open the transaction to see it or undo it.");
  await expect
    .element(card().getByRole("link", { name: "Open the transaction" }))
    .toHaveAttribute("href", `/ledger/${postingId}`);
  expect(event).toMatchObject({ version: 2, allocations: [{ nonPersonal: true }] });
  expect(proposal).toMatchObject({ status: "accepted", commandId: [...corrected.keys()][0] });
  await expect.element(card().getByRole("button", { name: "Ignore" })).not.toBeInTheDocument();
});

test("Retry after Accept lost its reply accepts the change applied the first time, once", async ({
  onTestFinished,
}) => {
  serve();
  // The dinner is corrected, and the reply to recording the acceptance is lost.
  vi.mocked(resolveProposal).mockRejectedValueOnce(
    new AppRequestError("unavailable", "The analyst could not be reached. Try again."),
  );
  await renderConversation(onTestFinished);

  await card().getByRole("button", { name: "Accept" }).click();
  const retry = card().getByRole("button", { name: "Retry" });
  await expect.element(retry).toHaveFocus();
  await retry.click();

  await expect
    .element(card().getByText(/^Accepted 26 September 2026\./))
    .toHaveTextContent("Accepted 26 September 2026. Open the transaction to see it or undo it.");
  expect(event).toMatchObject({ version: 2, allocations: [{ nonPersonal: true }] });
  expect([...corrected.keys()]).toHaveLength(1);
  expect(proposal).toMatchObject({ status: "accepted", commandId: [...corrected.keys()][0] });
});

test("a transaction changed since the preview makes the proposal stale, and Preview again reads it as it is now", async ({
  onTestFinished,
}) => {
  serve();
  // Moved to Groceries by hand after the analyst proposed marking it non-personal.
  event = {
    ...dinner,
    version: 2,
    allocations: [{ ...dinner.allocations[0], categoryId: groceries, categorySource: "user" }],
  };
  await renderConversation(onTestFinished);

  await card().getByRole("button", { name: "Accept" }).click();

  const stale = card().getByText("This transaction changed after the analyst proposed this.");
  await expect.element(stale).toHaveFocus();
  expect(proposal.status).toBe("stale");
  expect(event).toMatchObject({ version: 2, allocations: [{ nonPersonal: false }] });
  await card().getByRole("button", { name: "Preview again" }).click();

  await expect.element(card().getByRole("button", { name: "Accept" })).toHaveFocus();
  await expect
    .element(card().getByRole("row", { name: /^Non-personal portion/ }))
    .toHaveTextContent("Non-personal portionNoYes");
  await card().getByRole("button", { name: "Accept" }).click();

  await expect.element(card().getByText(/^Accepted 26 September 2026\./)).toBeVisible();
  expect(event).toMatchObject({
    version: 3,
    allocations: [{ categoryId: groceries, nonPersonal: true }],
  });
});

test("a stale proposal that Preview again finds already made can still be ignored", async ({
  onTestFinished,
}) => {
  serve();
  // Marked non-personal by hand after the analyst proposed it.
  event = {
    ...dinner,
    version: 2,
    allocations: [{ ...dinner.allocations[0], nonPersonal: true, categorySource: "user" }],
  };
  await renderConversation(onTestFinished);

  await card().getByRole("button", { name: "Accept" }).click();
  await expect
    .element(card().getByText("This transaction changed after the analyst proposed this."))
    .toHaveFocus();
  const again = card().getByRole("button", { name: "Preview again" });
  await again.click();

  await expect
    .element(card().getByRole("alert"))
    .toHaveTextContent("This change leaves Rockpool on 12 August 2026 as it is.");
  await expect.element(again).toHaveFocus();
  await card().getByRole("button", { name: "Ignore" }).click();

  await expect.element(card().getByText("Ignored")).toHaveFocus();
  await expect.element(card().getByRole("alert")).not.toBeInTheDocument();
  expect(proposal.status).toBe("ignored");
});

test("Accept on a default proposal changes the counterparty's default once and links to it", async ({
  onTestFinished,
}) => {
  serve(diningOutDefault);
  await renderConversation(onTestFinished);
  const woolworthsCard = card("Set the default category to Dining out for Woolworths");

  await expect
    .element(woolworthsCard.getByRole("row", { name: /^Default category/ }))
    .toHaveTextContent("Default categoryGroceriesDining out");
  await expect
    .element(woolworthsCard.getByRole("row", { name: /^Default role/ }))
    .not.toBeInTheDocument();
  await expect
    .element(woolworthsCard.getByText("Changes 21 transactions; totals stay the same."))
    .toBeVisible();
  await woolworthsCard.getByRole("button", { name: "Accept" }).click();

  await expect
    .element(woolworthsCard.getByText(/^Accepted 26 September 2026\./))
    .toHaveTextContent("Accepted 26 September 2026. Open the counterparty to see it or undo it.");
  await expect
    .element(woolworthsCard.getByRole("link", { name: "Open the counterparty" }))
    .toHaveAttribute("href", `/counterparties/${woolworthsId}`);
  expect(woolworths).toMatchObject({
    version: 2,
    defaultCategoryId: diningOut,
    name: "Woolworths",
  });
  expect([...changed.keys()]).toHaveLength(1);
  expect(proposal).toMatchObject({ status: "accepted", commandId: [...changed.keys()][0] });
});

test("a counterparty changed since the preview makes its default proposal stale", async ({
  onTestFinished,
}) => {
  serve(diningOutDefault);
  // Renamed in another tab after the analyst proposed the default.
  woolworths = { ...woolworthsAtFirst, name: "Woolworths Metro", version: 2 };
  await renderConversation(onTestFinished);
  const woolworthsCard = card("Set the default category to Dining out for Woolworths");

  await woolworthsCard.getByRole("button", { name: "Accept" }).click();

  await expect
    .element(woolworthsCard.getByText("This counterparty changed after the analyst proposed this."))
    .toHaveFocus();
  expect(woolworths).toMatchObject({ version: 2, defaultCategoryId: groceries });
  expect(proposal.status).toBe("stale");
});

test("a reference default's card names the payments it is for and the defaults they followed", async ({
  onTestFinished,
}) => {
  serve(rentDefault);
  await renderConversation(onTestFinished);
  const rentCard = card("Set a reference default for Sam: Purchase, Housing");

  await expect.element(rentCard.getByText("For payments marked RENT")).toBeVisible();
  const table = rentCard.getByRole("table", { name: "What changes for payments marked RENT" });
  await expect
    .element(table.getByRole("row", { name: /^Role/ }))
    .toHaveTextContent("RoleAs the defaults sayPurchase");
  await expect
    .element(table.getByRole("row", { name: /^Category/ }))
    .toHaveTextContent("CategoryAs the defaults sayHousing");
  await expect
    .element(rentCard.getByText("Changes 3 transactions; totals stay the same."))
    .toBeVisible();
});
