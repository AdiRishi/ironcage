import {
  type Counterparty,
  CounterpartyChange,
  CounterpartyChangeId,
  CounterpartyId,
  type DescriptorMatch,
  Instant,
  type ReferenceData,
} from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
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

import { Descriptors } from "@/features/counterparties/descriptors";
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
import { counterpartyQuery } from "@/features/counterparties/queries";
import { TakeDescriptor } from "@/features/counterparties/take-descriptor";
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
const coles = CounterpartyId.make("00000000-0000-4000-8000-000000000002");
const aldi = CounterpartyId.make("00000000-0000-4000-8000-000000000003");
const printed = "WOOLWORTHS METRO 5678 SYDNEY";
const stale = () =>
  new AppRequestError(
    "stale",
    "This descriptor changed since you opened it. Review it and try again.",
  );

test("taking a descriptor confirms with the alias version shown, and a stale reply keeps the dialog on the current holder", async ({
  onTestFinished,
}) => {
  // The one descriptor the bank prints as WOOLWORTHS METRO 5678 SYDNEY, with the
  // counterparty that holds it and its alias version.
  let alias: NonNullable<(typeof DescriptorMatch.Type)["alias"]> = {
    counterpartyId: coles,
    counterpartyName: "Coles",
    status: "applied",
    source: "model",
    version: 3,
  };
  const current = (expected: number | null) => expected === alias.version;
  vi.mocked(searchDescriptors).mockImplementation(async ({ data }) =>
    printed.includes(data.search.toUpperCase()) &&
    alias.counterpartyId !== data.excludeCounterpartyId
      ? [{ aliasKey: "WOOLWORTHS METRO", samples: [printed], eventCount: 4, alias }]
      : [],
  );
  vi.mocked(previewCounterpartyChange).mockImplementation(async ({ data }) => {
    const change = await Effect.runPromise(Schema.decodeEffect(CounterpartyChange)(data.change));
    if (change.kind !== "moveAlias" || !current(change.expectedVersion)) throw stale();
    return { change, eventCount: 4, impacts: [], event: null };
  });
  vi.mocked(applyCounterpartyChange).mockImplementation(async ({ data: { change } }) => {
    if (change.kind !== "moveAlias" || !current(change.expectedVersion)) throw stale();
    alias = {
      counterpartyId: woolworths.id,
      counterpartyName: woolworths.name,
      status: "applied",
      source: "user",
      version: alias.version + 1,
    };
    return {
      changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
      counterparty: woolworths,
    };
  });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <TakeDescriptor counterparty={woolworths} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(searchDescriptors).mockReset();
    vi.mocked(previewCounterpartyChange).mockReset();
    vi.mocked(applyCounterpartyChange).mockReset();
  });

  await page.getByRole("button", { name: "Take a descriptor" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Find what the bank printed" }).fill("5678");
  await page.getByRole("option", { name: new RegExp(printed) }).click();
  await expect.element(dialog.getByText("Now resolves to Coles · 4 transactions")).toBeVisible();
  await expect
    .element(dialog.getByText("Changes 4 transactions; totals stay the same."))
    .toBeVisible();

  alias = {
    counterpartyId: aldi,
    counterpartyName: "Aldi",
    status: "applied",
    source: "user",
    version: 4,
  };
  await dialog.getByRole("button", { name: "Take it for Woolworths" }).click();
  await expect
    .element(dialog.getByRole("alert"))
    .toMatchTextContent(/This descriptor changed since you opened it/);
  await expect.element(dialog.getByText("Now resolves to Aldi · 4 transactions")).toBeVisible();
  expect(alias.counterpartyName).toBe("Aldi");

  await dialog.getByRole("button", { name: "Preview again" }).click();
  await dialog.getByRole("button", { name: "Take it for Woolworths" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(alias).toMatchObject({ counterpartyName: "Woolworths", version: 5 });
});

test("moving a descriptor to another counterparty takes it off the list and leaves focus on the list's heading", async ({
  onTestFinished,
}) => {
  // Coles holds the Metro descriptor by mistake.
  let holder = coles;
  const metro = {
    aliasKey: "WOOLWORTHS METRO",
    source: "model",
    status: "applied",
    version: 3,
    samples: [printed],
    channel: null,
    eventCount: 4,
  } as const;
  vi.mocked(getCounterparty).mockImplementation(async () => ({
    counterparty: {
      ...woolworths,
      id: coles,
      name: "Coles",
      eventCount: 4,
      outflowEvents: 4,
      inflowEvents: 0,
      outflow: { currency: "AUD", minor: 10000n },
      inflow: { currency: "AUD", minor: 0n },
      lastOn: null,
    },
    aliases: holder === coles ? [metro] : [],
    months: [],
    references: [],
  }));
  const move = async (encoded: typeof CounterpartyChange.Encoded) => {
    const change = await Effect.runPromise(Schema.decodeEffect(CounterpartyChange)(encoded));
    if (change.kind !== "moveAlias" || change.expectedVersion !== metro.version) throw stale();
    return change;
  };
  vi.mocked(previewCounterpartyChange).mockImplementation(async ({ data }) => ({
    change: await move(data.change),
    eventCount: 4,
    impacts: [],
    event: null,
  }));
  vi.mocked(applyCounterpartyChange).mockImplementation(async ({ data }) => {
    const change = await move(data.change);
    if (change.kind !== "moveAlias") throw new Error("Expected a descriptor move");
    holder = change.counterpartyId;
    return {
      changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
      counterparty: woolworths,
    };
  });
  const references: typeof ReferenceData.Type = {
    categories: [],
    counterparties: [
      { id: coles, name: "Coles", kind: "business", version: 1 },
      { id: woolworths.id, name: woolworths.name, kind: "business", version: woolworths.version },
    ],
    tags: [],
    personalEvents: [],
  };
  function ColesDescriptors() {
    const { data } = useSuspenseQuery(counterpartyQuery(coles));
    return <Descriptors detail={data} references={references} />;
  }
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <ColesDescriptors />
      </Suspense>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
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

  await page.getByRole("button", { name: `Move to… ${printed}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Move it to" }).fill("Wool");
  await page.getByRole("option", { name: /Woolworths/ }).click();
  await dialog.getByRole("button", { name: "Move to Woolworths" }).click();

  await expect.element(dialog).not.toBeInTheDocument();
  await expect
    .element(page.getByText("No descriptor resolves to Coles.", { exact: false }))
    .toBeVisible();
  await expect.element(page.getByRole("heading", { name: "How the bank writes it" })).toHaveFocus();
  expect(holder).toBe(woolworths.id);
});
