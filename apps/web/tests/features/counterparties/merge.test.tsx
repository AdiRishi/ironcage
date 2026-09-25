import {
  type Counterparty,
  CounterpartyChange,
  CounterpartyChangeId,
  type CounterpartyDetail,
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
import { Merge } from "@/features/counterparties/merge";
import { counterpartyQuery } from "@/features/counterparties/queries";
import { getModelUsage, getRetention, getSettings } from "@/features/settings/functions";
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
vi.mock("../../../src/features/settings/functions", () => ({
  getSettings: vi.fn<typeof getSettings>(),
  getRetention: vi.fn<typeof getRetention>(),
  getModelUsage: vi.fn<typeof getModelUsage>(),
}));

const person = (id: string, name: string, version: number): Counterparty => ({
  id: CounterpartyId.make(id),
  name,
  kind: "person",
  brand: null,
  defaultCategoryId: null,
  defaultRole: "purchase",
  source: "user",
  status: "applied",
  model: null,
  confidence: null,
  reason: null,
  version,
  updatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
});
// J Smith is the same person as Jane Smith, entered twice.
const duplicate = person("00000000-0000-4000-8000-000000000001", "J Smith", 3);
const jane = person("00000000-0000-4000-8000-000000000002", "Jane Smith", 5);
const references: typeof ReferenceData.Type = {
  categories: [],
  counterparties: [duplicate, jane].map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    version: row.version,
  })),
  tags: [],
  personalEvents: [],
};
const detail = (counterparty: Counterparty): typeof CounterpartyDetail.Type => ({
  counterparty: {
    ...counterparty,
    eventCount: 1,
    outflowEvents: 1,
    inflowEvents: 0,
    outflow: { currency: "AUD", minor: 60000n },
    inflow: { currency: "AUD", minor: 0n },
    lastOn: null,
  },
  aliases: [],
  months: [],
  references: [],
});

function CounterpartyScreen() {
  const { counterpartyId } = useParams({ strict: false });
  const { data } = useSuspenseQuery(counterpartyQuery(CounterpartyId.make(counterpartyId ?? "")));
  return (
    <>
      <h1>{data.counterparty.name}</h1>
      <Merge counterparty={data.counterparty} references={references} />
    </>
  );
}

test("merging opens the counterparty that remains without reading the one it removed", async ({
  onTestFinished,
}) => {
  const counterparties = new Map([
    [duplicate.id, duplicate],
    [jane.id, jane],
  ]);
  // A removed counterparty never answers, so reading its page again would leave the
  // test waiting on it.
  vi.mocked(getCounterparty).mockImplementation(({ data }) => {
    const found = counterparties.get(CounterpartyId.make(data.counterpartyId));
    return found ? Promise.resolve(detail(found)) : new Promise(() => {});
  });
  const merge = async (encoded: typeof CounterpartyChange.Encoded) => {
    const change = await Effect.runPromise(Schema.decodeEffect(CounterpartyChange)(encoded));
    if (
      change.kind !== "merge" ||
      change.sourceVersion !== counterparties.get(change.sourceId)?.version ||
      change.targetVersion !== counterparties.get(change.targetId)?.version
    )
      throw new AppRequestError("stale", "A counterparty changed. Review both and merge again.");
    return change;
  };
  vi.mocked(previewCounterpartyChange).mockImplementation(async ({ data }) => ({
    change: await merge(data.change),
    eventCount: 1,
    impacts: [],
    event: null,
  }));
  vi.mocked(applyCounterpartyChange).mockImplementation(async ({ data }) => {
    const change = await merge(data.change);
    if (change.kind !== "merge") throw new Error("Expected a merge");
    counterparties.delete(change.sourceId);
    return {
      changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
      counterparty: jane,
    };
  });
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <CounterpartyScreen />
      </Suspense>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/counterparties/$counterpartyId" }),
    ]),
    history: createMemoryHistory({ initialEntries: [`/counterparties/${duplicate.id}`] }),
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
    vi.mocked(previewCounterpartyChange).mockReset();
    vi.mocked(applyCounterpartyChange).mockReset();
  });

  await expect.element(page.getByRole("heading", { name: "J Smith" })).toBeVisible();
  await page.getByRole("button", { name: "This is the same as another counterparty" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Merge into" }).fill("Jane");
  await page.getByRole("option", { name: /Jane Smith/ }).click();
  await expect
    .element(dialog.getByText("Changes 1 transaction; totals stay the same."))
    .toBeVisible();
  await dialog.getByRole("button", { name: "Merge into Jane Smith" }).click();

  await expect.element(page.getByRole("heading", { name: "Jane Smith" })).toBeVisible();
  expect(router.state.location.pathname).toBe(`/counterparties/${jane.id}`);
});
