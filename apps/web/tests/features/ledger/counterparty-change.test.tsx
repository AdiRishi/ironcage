import {
  AccountId,
  AllocationId,
  CategoryId,
  type Counterparty,
  CounterpartyChange as Change,
  CounterpartyChangeId,
  CounterpartyId,
  EventId,
  type FinancialEvent,
  Instant,
  PostingId,
  type ReferenceData,
} from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
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
import { CounterpartyChange } from "@/features/ledger/counterparty-change";
import { getRetention, getSettings } from "@/features/settings/functions";
import { AppRequestError } from "@/lib/app-error";
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
vi.mock("../../../src/features/settings/functions", () => ({
  getSettings: vi.fn<typeof getSettings>(),
  getRetention: vi.fn<typeof getRetention>(),
}));

const coles = CounterpartyId.make("00000000-0000-4000-8000-000000000002");
const woolworths: Counterparty = {
  id: CounterpartyId.make("00000000-0000-4000-8000-000000000001"),
  name: "Woolworths",
  kind: "business",
  brand: null,
  defaultCategoryId: null,
  defaultRole: null,
  source: "user",
  status: "applied",
  model: null,
  confidence: null,
  reason: null,
  version: 2,
  updatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
};
const groceries = CategoryId.make("00000000-0000-4000-8000-0000000000f1");
const references: typeof ReferenceData.Type = {
  categories: [
    {
      id: groceries,
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
    { id: woolworths.id, name: woolworths.name, kind: "business", version: woolworths.version },
  ],
  tags: [],
  personalEvents: [],
};
// A $25.00 purchase the bank wrote as WOOLWORTHS METRO, which resolves to Coles by
// mistake. Two more transactions are written the same way.
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
      categoryId: groceries,
      categorySource: "counterparty",
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
  eventCount: 3,
  aliasVersion: 2,
};
const stale = () => new AppRequestError("stale", "This changed. Review it and try again.");

// The API as far as moving a transaction goes: the transaction and the alias for its
// descriptor, each at the version it has now. The transaction follows its descriptor
// unless it was moved by hand, and a descriptor move chosen from it takes it along.
function serve(event: FinancialEvent) {
  const records = {
    event,
    alias: { counterpartyId: coles, version: descriptor.aliasVersion },
  };
  vi.mocked(previewEventCounterparty).mockImplementation(async ({ data }) => ({
    after: {
      ...records.event,
      counterpartyId: data.counterpartyId
        ? CounterpartyId.make(data.counterpartyId)
        : records.alias.counterpartyId,
      counterpartySource: data.counterpartyId ? "user" : "alias",
      version: records.event.version + 1,
    },
    expectedVersions: [{ eventId: records.event.id, version: records.event.version }],
    impacts: [],
  }));
  vi.mocked(assignEventCounterparty).mockImplementation(async ({ data }) => {
    if (data.expectedVersions[0].version !== records.event.version) throw stale();
    records.event = {
      ...records.event,
      counterpartyId: data.counterpartyId ? CounterpartyId.make(data.counterpartyId) : null,
      counterpartySource: data.counterpartyId ? "user" : "alias",
      version: records.event.version + 1,
    };
    return records.event;
  });
  const moveAlias = async (encoded: typeof Change.Encoded) => {
    const change = await Effect.runPromise(Schema.decodeEffect(Change)(encoded));
    if (
      change.kind !== "moveAlias" ||
      change.expectedVersion !== records.alias.version ||
      change.event?.eventId !== records.event.id ||
      change.event.version !== records.event.version
    )
      throw stale();
    return {
      change,
      alias: { counterpartyId: change.counterpartyId, version: records.alias.version + 1 },
      event: {
        ...records.event,
        counterpartyId: change.counterpartyId,
        counterpartySource: "alias" as const,
        version: records.event.version + 1,
      },
    };
  };
  vi.mocked(previewCounterpartyChange).mockImplementation(async ({ data }) => {
    const { change, event: after } = await moveAlias(data.change);
    return { change, eventCount: descriptor.eventCount, impacts: [], event: after };
  });
  vi.mocked(applyCounterpartyChange).mockImplementation(async ({ data }) => {
    const moved = await moveAlias(data.change);
    records.alias = moved.alias;
    records.event = moved.event;
    return {
      changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
      counterparty: woolworths,
    };
  });
  return records;
}

async function renderChange(
  event: FinancialEvent,
  onTestFinished: (cleanup: () => Promise<void>) => void,
) {
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <CounterpartyChange event={event} descriptor={descriptor} references={references} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(previewEventCounterparty).mockReset();
    vi.mocked(assignEventCounterparty).mockReset();
    vi.mocked(previewCounterpartyChange).mockReset();
    vi.mocked(applyCounterpartyChange).mockReset();
  });
  await page.getByRole("button", { name: "Change the counterparty" }).click();
  const dialog = page.getByRole("dialog");
  await expect.element(dialog.getByRole("button", { name: "Move", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Who it was with" }).fill("Wool");
  await page.getByRole("option", { name: /Woolworths/ }).click();
  return dialog;
}

test("moving a transaction whose descriptor has other transactions asks which move, and moving every one moves the descriptor", async ({
  onTestFinished,
}) => {
  const records = serve(purchase);
  const dialog = await renderChange(purchase, onTestFinished);

  await expect
    .element(dialog.getByRole("radiogroup", { name: "Which transactions move" }))
    .toBeVisible();
  await expect.element(dialog.getByRole("button", { name: "Move to Woolworths" })).toBeDisabled();
  await dialog
    .getByRole("radio", { name: "Every transaction written as WOOLWORTHS METRO (3)" })
    .click();
  await expect
    .element(dialog.getByText("Changes 3 transactions; totals stay the same."))
    .toBeVisible();
  await dialog.getByRole("button", { name: "Move all 3 to Woolworths" }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  expect(records.alias).toEqual({ counterpartyId: woolworths.id, version: 3 });
  expect(records.event).toMatchObject({
    counterpartyId: woolworths.id,
    counterpartySource: "alias",
  });
});

test("moving every transaction from one you moved by hand shows where it ends up and takes it along", async ({
  onTestFinished,
}) => {
  const moved: FinancialEvent = { ...purchase, counterpartySource: "user" };
  const records = serve(moved);
  const dialog = await renderChange(moved, onTestFinished);

  await dialog
    .getByRole("radio", { name: "Every transaction written as WOOLWORTHS METRO (3)" })
    .click();
  const outcome = dialog.getByRole("definition");
  await expect.element(outcome.nth(0)).toHaveTextContent("Woolworths");
  await expect.element(outcome.nth(2)).toHaveTextContent("Groceries");
  await dialog.getByRole("button", { name: "Move all 3 to Woolworths" }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  expect(records.event).toMatchObject({
    counterpartyId: woolworths.id,
    counterpartySource: "alias",
    version: 6,
  });
});

test("moving only this transaction assigns it by hand and leaves its descriptor where it was", async ({
  onTestFinished,
}) => {
  const records = serve(purchase);
  const dialog = await renderChange(purchase, onTestFinished);

  await dialog.getByRole("radio", { name: "Only this one" }).click();
  await expect
    .element(dialog.getByText("Changes 1 transaction; totals stay the same."))
    .toBeVisible();
  await dialog.getByRole("button", { name: "Move to Woolworths" }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  expect(records.event).toMatchObject({
    counterpartyId: woolworths.id,
    counterpartySource: "user",
    version: 6,
  });
  expect(records.alias).toEqual({ counterpartyId: coles, version: 2 });
});
