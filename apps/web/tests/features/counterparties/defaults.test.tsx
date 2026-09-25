import {
  CategoryId,
  type Counterparty,
  CounterpartyChange,
  CounterpartyChangeId,
  type CounterpartyDetail,
  CounterpartyId,
  Instant,
  type ReferenceData,
} from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { Suspense } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { Defaults } from "@/features/counterparties/defaults";
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

const category = (id: string, name: string, slug: string, position: number) => ({
  id: CategoryId.make(id),
  parentId: null,
  name,
  slug,
  tree: "spending" as const,
  position,
  archived: false,
  version: 1,
});
const groceries = category(
  "00000000-0000-4000-8000-0000000000f1",
  "Groceries",
  "food.groceries",
  1,
);
const dining = category("00000000-0000-4000-8000-0000000000f2", "Dining out", "food.dining", 2);
const references: typeof ReferenceData.Type = {
  categories: [groceries, dining],
  counterparties: [],
  tags: [],
  personalEvents: [],
};
const woolworths: Counterparty = {
  id: CounterpartyId.make("00000000-0000-4000-8000-000000000001"),
  name: "Woolworths",
  kind: "business",
  brand: null,
  defaultCategoryId: groceries.id,
  defaultRole: null,
  source: "user",
  status: "applied",
  model: null,
  confidence: null,
  reason: null,
  version: 3,
  updatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
};
const detail = (counterparty: Counterparty): typeof CounterpartyDetail.Type => ({
  counterparty: {
    ...counterparty,
    eventCount: 2,
    outflowEvents: 2,
    inflowEvents: 0,
    outflow: { currency: "AUD", minor: 6700n },
    inflow: { currency: "AUD", minor: 0n },
    lastOn: null,
  },
  aliases: [],
  months: [],
  references: [],
});

function DefaultsScreen() {
  const { data } = useSuspenseQuery(counterpartyQuery(woolworths.id));
  return <Defaults counterparty={data.counterparty} references={references} />;
}

test("a save another change overtook keeps your edits, and Keep my edits previews and saves them at the new version", async ({
  onTestFinished,
}) => {
  let record = woolworths;
  vi.mocked(getCounterparty).mockImplementation(async () => detail(record));
  const update = async (encoded: typeof CounterpartyChange.Encoded) => {
    const change = await Effect.runPromise(Schema.decodeEffect(CounterpartyChange)(encoded));
    if (change.kind !== "update" || change.expectedVersion !== record.version)
      throw new AppRequestError("stale", "This counterparty changed. Review it and save again.");
    return change;
  };
  vi.mocked(previewCounterpartyChange).mockImplementation(async ({ data }) => ({
    change: await update(data.change),
    eventCount: 2,
    impacts: [],
    event: null,
  }));
  vi.mocked(applyCounterpartyChange).mockImplementation(async ({ data }) => {
    const change = await update(data.change);
    if (change.kind !== "update") throw new Error("Expected an update");
    record = { ...record, ...change.fields, version: record.version + 1 };
    return {
      changeId: CounterpartyChangeId.make("00000000-0000-4000-8000-0000000000c1"),
      counterparty: record,
    };
  });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Loading</p>}>
        <DefaultsScreen />
      </Suspense>
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(getCounterparty).mockReset();
    vi.mocked(previewCounterpartyChange).mockReset();
    vi.mocked(applyCounterpartyChange).mockReset();
  });

  const name = page.getByRole("textbox", { name: "Name" });
  await name.fill("Woolworths Supermarkets");
  // Another tab moves Woolworths to Dining out while you edit.
  record = { ...record, defaultCategoryId: dining.id, version: 4 };
  await page.getByRole("button", { name: "Preview" }).click();
  await expect
    .element(page.getByRole("alert"))
    .toMatchTextContent(/Now: Woolworths, business, usually Dining out\. Your edits are still/);
  await expect.element(name).toHaveValue("Woolworths Supermarkets");

  await page.getByRole("button", { name: "Keep my edits" }).click();
  const preview = page.getByRole("button", { name: "Preview" });
  await expect.element(preview).toHaveFocus();
  await preview.click();
  const apply = page.getByRole("button", { name: "Apply to all 2 Woolworths transactions" });
  await expect.element(apply).toHaveFocus();
  await apply.click();

  await expect.element(page.getByText("Saved.")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Preview" })).toHaveFocus();
  await expect.element(name).toHaveValue("Woolworths Supermarkets");
  expect(record).toMatchObject({ name: "Woolworths Supermarkets", version: 5 });
});
