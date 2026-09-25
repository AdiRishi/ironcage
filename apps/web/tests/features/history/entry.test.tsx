import {
  CategoryId,
  type Counterparty,
  type CounterpartyChangeEntry,
  CounterpartyChangeId,
  CounterpartyId,
  Instant,
  type ReferenceData,
} from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";
import { Struct } from "effect";
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
import { CounterpartyHistory } from "@/features/counterparties/history";
import { counterpartyQuery } from "@/features/counterparties/queries";
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
import { HistoryEntry } from "@/features/history/entry";
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

const groceries = CategoryId.make("00000000-0000-4000-8000-0000000000f1");
const diningOut = CategoryId.make("00000000-0000-4000-8000-0000000000f2");
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
    {
      id: diningOut,
      parentId: null,
      name: "Dining out",
      slug: "food.dining",
      tree: "spending",
      position: 2,
      archived: false,
      version: 1,
    },
  ],
  counterparties: [],
  tags: [],
  personalEvents: [],
};
const woolworths: Counterparty = {
  id: CounterpartyId.make("00000000-0000-4000-8000-000000000001"),
  name: "Woolworths",
  kind: "business",
  brand: null,
  defaultCategoryId: diningOut,
  defaultRole: null,
  source: "user",
  status: "applied",
  model: null,
  confidence: null,
  reason: null,
  version: 3,
  updatedAt: Instant.make("2026-09-25T06:30:00.000Z"),
};
const record = Struct.omit(woolworths, ["updatedAt"]);

// Woolworths's default category moved from Groceries to Dining out at 06:30 UTC on
// 25 September 2026, changing two transactions.
const recategorised = (
  state: Pick<typeof CounterpartyChangeEntry.Type, "undoable" | "undone">,
): typeof CounterpartyChangeEntry.Type => ({
  id: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
  kind: "update",
  undoes: null,
  images: {
    counterparties: [
      { before: { ...record, defaultCategoryId: groceries, version: 2 }, after: record },
    ],
    aliases: [],
    references: [],
    events: [],
    rules: [],
    movements: [],
  },
  subjects: [{ id: woolworths.id, name: woolworths.name }],
  eventCount: 2,
  createdAt: Instant.make("2026-09-25T06:30:00.000Z"),
  ...state,
});

test("a change that can no longer be undone says why instead of offering Undo", async ({
  onTestFinished,
}) => {
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <ol>
        {[
          recategorised({ undoable: false, undone: true }),
          recategorised({ undoable: false, undone: false }),
        ].map((change) => (
          <li key={String(change.undone)}>
            <HistoryEntry
              entry={{ kind: "counterparty", change }}
              references={references}
              timeZone="Australia/Sydney"
            />
          </li>
        ))}
      </ol>
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
  });

  const entries = page.getByRole("listitem");
  await expect.element(entries.nth(0)).toMatchTextContent(/Undone$/);
  await expect.element(entries.nth(1)).toMatchTextContent(/Changed again later$/);
  await expect.element(page.getByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
});

test("undoing a change previews what it changes, then the history shows it undone and takes focus", async ({
  onTestFinished,
}) => {
  let rows = [recategorised({ undoable: true, undone: false })];
  vi.mocked(listCounterpartyHistory).mockImplementation(async () => ({ rows, nextCursor: null }));
  vi.mocked(previewCounterpartyUndo).mockImplementation(async () => ({
    eventCount: 2,
    impacts: [],
  }));
  vi.mocked(undoCounterpartyChange).mockImplementation(async ({ data }) => {
    const [undone] = rows;
    if (!undone?.undoable || undone.id !== data.changeId)
      throw new AppRequestError("stale", "A later change touched these records. Undo it first.");
    const undo = CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c2");
    rows = [
      {
        ...undone,
        id: undo,
        kind: "undo",
        undoes: { id: undone.id, kind: "update" },
        createdAt: Instant.make("2026-09-25T07:00:00.000Z"),
      },
      { ...undone, undoable: false, undone: true },
    ];
    return { changeId: undo, removed: [] };
  });
  const root = createRootRoute({
    component: () => (
      <CounterpartyHistory
        counterparty={woolworths}
        references={references}
        timeZone="Asia/Tokyo"
      />
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: [`/counterparties/${woolworths.id}`] }),
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
    vi.mocked(listCounterpartyHistory).mockReset();
    vi.mocked(previewCounterpartyUndo).mockReset();
    vi.mocked(undoCounterpartyChange).mockReset();
  });

  const entry = page.getByRole("listitem");
  await expect
    .element(entry)
    .toMatchTextContent(
      /Default category changed from Groceries to Dining out\..*3:30\spm · Every Woolworths transaction, 2 transactions changed/,
    );
  await entry.getByRole("button", { name: /^Undo/ }).click();
  const dialog = page.getByRole("dialog");
  await expect
    .element(dialog.getByText("Changes 2 transactions; totals stay the same."))
    .toBeVisible();
  await dialog.getByRole("button", { name: "Undo the change" }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(page.getByText("Undid a change to a counterparty.")).toBeVisible();
  await expect.element(page.getByRole("listitem").nth(1)).toMatchTextContent(/Undone$/);
  // Undo left with the dialog, so focus is on what replaced it.
  await expect.element(page.getByText("Undone", { exact: true })).toHaveFocus();
});

test("undoing a counterparty's creation leaves for the counterparty list without reading the counterparty again", async ({
  onTestFinished,
}) => {
  const created: typeof CounterpartyChangeEntry.Type = {
    ...recategorised({ undoable: true, undone: false }),
    kind: "create",
    images: {
      counterparties: [{ before: null, after: record }],
      aliases: [],
      references: [],
      events: [],
      rules: [],
      movements: [],
    },
    eventCount: 0,
  };
  let removed = false;
  // A removed counterparty never answers, so reading it again would leave the test
  // waiting on it.
  const unless = <A,>(value: A) => (removed ? new Promise<A>(() => {}) : Promise.resolve(value));
  vi.mocked(getCounterparty).mockImplementation(() =>
    unless({
      counterparty: {
        ...woolworths,
        eventCount: 0,
        outflowEvents: 0,
        inflowEvents: 0,
        outflow: { currency: "AUD", minor: 0n },
        inflow: { currency: "AUD", minor: 0n },
        lastOn: null,
      },
      aliases: [],
      months: [],
      references: [],
    }),
  );
  vi.mocked(listCounterpartyHistory).mockImplementation(() =>
    unless({ rows: [created], nextCursor: null }),
  );
  vi.mocked(previewCounterpartyUndo).mockImplementation(async () => ({
    eventCount: 0,
    impacts: [],
  }));
  vi.mocked(undoCounterpartyChange).mockImplementation(async () => {
    removed = true;
    return {
      changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c2"),
      removed: [woolworths.id],
    };
  });
  function Screen() {
    const { counterpartyId } = useParams({ strict: false });
    return counterpartyId ? <CounterpartyScreen /> : <p>Every counterparty</p>;
  }
  function CounterpartyScreen() {
    const { data } = useSuspenseQuery(counterpartyQuery(woolworths.id));
    return (
      <CounterpartyHistory
        counterparty={data.counterparty}
        references={references}
        timeZone="Australia/Sydney"
      />
    );
  }
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <Screen />
      </Suspense>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/counterparties" }),
      createRoute({ getParentRoute: () => root, path: "/counterparties/$counterpartyId" }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/counterparties/${woolworths.id}`] }),
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
    vi.mocked(getCounterparty).mockReset();
    vi.mocked(listCounterpartyHistory).mockReset();
    vi.mocked(previewCounterpartyUndo).mockReset();
    vi.mocked(undoCounterpartyChange).mockReset();
  });

  await page.getByRole("button", { name: /^Undo Created Woolworths/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Undo the change" }).click();

  await expect.element(page.getByText("Every counterparty")).toBeVisible();
  expect(router.state.location.pathname).toBe("/counterparties");
});
