import {
  AccountId,
  AllocationId,
  ApplyCorrection,
  CategoryId,
  CounterpartyChange,
  CounterpartyChangeId,
  type CounterpartyDetail,
  CounterpartyId,
  EventId,
  type FinancialEvent,
  Instant,
  PostingId,
  type ReferenceData,
} from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { Suspense } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import {
  applyCounterpartyChange,
  getCounterparty,
  listCounterparties,
  listCounterpartyHistory,
  previewCounterpartyChange,
  previewCounterpartyUndo,
  searchDescriptors,
  undoCounterpartyChange,
} from "@/features/counterparties/functions";
import {
  applyCorrection,
  assignEventCounterparty,
  getEvent,
  getEventForPosting,
  getEventHistory,
  getReferenceData,
  previewCorrection,
  previewEventCounterparty,
  previewUndoCorrection,
  reinterpretPostings,
  undoCorrection,
} from "@/features/events/functions";
import { Meaning } from "@/features/ledger/meaning";
import {
  applyRelationship,
  getEventRelationships,
  listRelationshipCandidates,
  previewRelationship,
} from "@/features/relationships/functions";
import { getRetention, getSettings, updateSettings } from "@/features/settings/functions";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/counterparties/functions", () => ({
  listCounterparties: vi.fn<typeof listCounterparties>(),
  getCounterparty: vi.fn<typeof getCounterparty>(),
  searchDescriptors: vi.fn<typeof searchDescriptors>(),
  previewCounterpartyChange: vi.fn<typeof previewCounterpartyChange>(),
  applyCounterpartyChange: vi.fn<typeof applyCounterpartyChange>(),
  listCounterpartyHistory: vi.fn<typeof listCounterpartyHistory>(),
  previewCounterpartyUndo: vi.fn<typeof previewCounterpartyUndo>(),
  undoCounterpartyChange: vi.fn<typeof undoCounterpartyChange>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  reinterpretPostings: vi.fn<typeof reinterpretPostings>(),
  getEvent: vi.fn<typeof getEvent>(),
  getEventForPosting: vi.fn<typeof getEventForPosting>(),
  getReferenceData: vi.fn<typeof getReferenceData>(),
  previewCorrection: vi.fn<typeof previewCorrection>(),
  applyCorrection: vi.fn<typeof applyCorrection>(),
  previewEventCounterparty: vi.fn<typeof previewEventCounterparty>(),
  assignEventCounterparty: vi.fn<typeof assignEventCounterparty>(),
  previewUndoCorrection: vi.fn<typeof previewUndoCorrection>(),
  undoCorrection: vi.fn<typeof undoCorrection>(),
  getEventHistory: vi.fn<typeof getEventHistory>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/relationships/functions", () => ({
  getEventRelationships: vi.fn<typeof getEventRelationships>(),
  listRelationshipCandidates: vi.fn<typeof listRelationshipCandidates>(),
  previewRelationship: vi.fn<typeof previewRelationship>(),
  applyRelationship: vi.fn<typeof applyRelationship>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/settings/functions", () => ({
  getSettings: vi.fn<typeof getSettings>(),
  updateSettings: vi.fn<typeof updateSettings>(),
  getRetention: vi.fn<typeof getRetention>(),
}));

const coles = CounterpartyId.make("00000000-0000-4000-8000-000000000002");
const woolworths = CounterpartyId.make("00000000-0000-4000-8000-000000000001");
const detail = (id: typeof CounterpartyId.Type, name: string): typeof CounterpartyDetail.Type => ({
  counterparty: {
    id,
    name,
    kind: "business",
    brand: null,
    defaultCategoryId: null,
    defaultRole: null,
    source: "user",
    status: "applied",
    model: null,
    confidence: null,
    reason: null,
    version: 1,
    updatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
    eventCount: 1,
    outflowEvents: 1,
    inflowEvents: 0,
    outflow: { currency: "AUD", minor: 2500n },
    inflow: { currency: "AUD", minor: 0n },
    lastOn: null,
  },
  aliases: [],
  months: [],
  references: [],
});
const references: typeof ReferenceData.Type = {
  categories: [
    {
      id: CategoryId.make("00000000-0000-4000-8000-0000000000f1"),
      parentId: null,
      name: "Groceries",
      slug: "food.groceries",
      tree: "spending",
      position: 1,
      archived: false,
      version: 1,
    },
  ],
  counterparties: [
    { id: coles, name: "Coles", kind: "business", version: 1 },
    { id: woolworths, name: "Woolworths", kind: "business", version: 1 },
  ],
  tags: [],
  personalEvents: [],
};
// A $25.00 purchase the bank wrote as WOOLWORTHS METRO, which resolves to Coles by
// mistake. It is the only transaction written that way.
const purchase: FinancialEvent = {
  id: EventId.make("00000000-0000-4000-8000-0000000000e1"),
  kind: "purchase",
  roleSource: "counterparty",
  counterpartyId: coles,
  counterpartySource: "alias",
  magnitude: { currency: "AUD", minor: 2500n },
  primaryPostingId: PostingId.make("00000000-0000-4000-8000-0000000000b1"),
  reportingAccountId: AccountId.make("00000000-0000-4000-8000-0000000000a1"),
  purchaseOn: null,
  active: true,
  version: 5,
  allocations: [
    {
      id: AllocationId.make("00000000-0000-4000-8000-0000000000d1"),
      role: "purchase",
      amount: { currency: "AUD", minor: 2500n },
      categoryId: null,
      categorySource: null,
      nonPersonal: false,
      tagIds: [],
      personalEventIds: [],
    },
  ],
  postings: [],
};
const descriptor = {
  aliasKey: "WOOLWORTHS METRO",
  counterpartyText: "WOOLWORTHS METRO",
  eventCount: 1,
  aliasVersion: 2,
};

// The API for one transaction. Woolworths's details answer only when the test releases
// them, so the test can look at the page while the page waits for them.
function serve() {
  const records = { event: purchase };
  const woolworthsRequested = Promise.withResolvers<void>();
  const woolworthsLoaded = Promise.withResolvers<void>();
  vi.mocked(getEventForPosting).mockImplementation(async () => records.event);
  vi.mocked(getReferenceData).mockResolvedValue(references);
  vi.mocked(getEventHistory).mockResolvedValue({ entries: [], names: [] });
  vi.mocked(getEventRelationships).mockResolvedValue({
    movement: null,
    credits: [],
    fees: [],
    remaining: [],
  });
  vi.mocked(getSettings).mockResolvedValue({
    timezone: "Australia/Sydney",
    reportingCurrency: "AUD",
    version: 1,
  });
  vi.mocked(getCounterparty).mockImplementation(async ({ data }) => {
    if (data.counterpartyId === coles) return detail(coles, "Coles");
    woolworthsRequested.resolve();
    await woolworthsLoaded.promise;
    return detail(woolworths, "Woolworths");
  });
  vi.mocked(previewEventCounterparty).mockImplementation(async () => ({
    after: { ...records.event, counterpartyId: woolworths, counterpartySource: "user" },
    expectedVersions: [{ eventId: records.event.id, version: records.event.version }],
    impacts: [],
  }));
  vi.mocked(assignEventCounterparty).mockImplementation(async () => {
    records.event = {
      ...records.event,
      counterpartyId: woolworths,
      counterpartySource: "user",
      version: records.event.version + 1,
    };
    return records.event;
  });
  return {
    records,
    woolworthsRequested: woolworthsRequested.promise,
    loadWoolworths: () => woolworthsLoaded.resolve(),
  };
}

async function renderMeaning(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const client = createQueryClient();
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading the page</p>}>
        <Meaning postingId={purchase.primaryPostingId} descriptor={descriptor} />
      </Suspense>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.resetAllMocks();
  });
}

test("moving a transaction to a counterparty the page has not loaded keeps the transaction on screen and focus on Change", async ({
  onTestFinished,
}) => {
  const api = serve();
  await renderMeaning(onTestFinished);

  const change = page.getByRole("button", { name: "Change the counterparty" });
  await change.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Who it was with" }).fill("Wool");
  await page.getByRole("option", { name: /Woolworths/ }).click();
  await dialog.getByRole("button", { name: "Move to Woolworths" }).click();

  await api.woolworthsRequested;
  expect(page.getByText("Loading the page").query()).toBeNull();
  await expect.element(page.getByRole("link", { name: "Coles" })).toBeVisible();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(change).toHaveFocus();

  api.loadWoolworths();
  await expect.element(page.getByRole("link", { name: "Woolworths" })).toBeVisible();
  await expect.element(change).toHaveFocus();
});

test("applying a category to every transaction from a counterparty moves focus to Apply, then back to the category", async ({
  onTestFinished,
}) => {
  serve();
  vi.mocked(previewCounterpartyChange).mockImplementation(async ({ data }) => ({
    change: await Effect.runPromise(Schema.decodeEffect(CounterpartyChange)(data.change)),
    eventCount: 1,
    impacts: [],
    event: null,
  }));
  vi.mocked(applyCounterpartyChange).mockImplementation(async () => ({
    changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
    counterparty: detail(coles, "Coles").counterparty,
  }));
  await renderMeaning(onTestFinished);

  const category = page.getByRole("combobox", { name: "Category" });
  await category.selectOptions("Groceries");
  await page.getByRole("button", { name: "Every Coles transaction" }).click();
  const apply = page.getByRole("button", { name: "Apply to all Coles transactions" });
  await expect.element(apply).toHaveFocus();
  await apply.click();

  await expect.element(apply).not.toBeInTheDocument();
  await expect.element(category).toHaveFocus();
});

test("filing only this transaction in a category corrects its category and keeps its amount and role", async ({
  onTestFinished,
}) => {
  const api = serve();
  vi.mocked(applyCorrection).mockImplementation(async ({ data }) => {
    const { change, expectedVersions } = await Effect.runPromise(
      Schema.decodeEffect(ApplyCorrection)(data),
    );
    if (expectedVersions[0].version !== api.records.event.version)
      throw new Error("The correction expected another version.");
    api.records.event = {
      ...api.records.event,
      kind: change.kind,
      purchaseOn: change.purchaseOn,
      allocations: change.allocations,
      version: api.records.event.version + 1,
    };
    return api.records.event;
  });
  await renderMeaning(onTestFinished);

  await page.getByRole("combobox", { name: "Category" }).selectOptions("Groceries");
  await page.getByRole("button", { name: "Only this one" }).click();

  await expect.poll(() => api.records.event.version).toBe(6);
  expect(api.records.event).toMatchObject({
    kind: "purchase",
    allocations: [
      {
        id: purchase.allocations[0].id,
        role: "purchase",
        amount: { currency: "AUD", minor: 2500n },
        categoryId: references.categories[0]?.id,
      },
    ],
  });
});
