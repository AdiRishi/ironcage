import { YearMonth } from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { getEventForPosting, getEventHistory, getReferenceData } from "@/features/events/functions";
import { LedgerPage } from "@/features/ledger/page";
import type { PostingSearch } from "@/features/ledger/search";
import { type PeriodRecords, resolvePeriodKey } from "@/lib/period";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  getEventForPosting: vi.fn<typeof getEventForPosting>(),
  getEventHistory: vi.fn<typeof getEventHistory>(),
  getReferenceData: vi.fn<typeof getReferenceData>(),
}));

const timezone = "Australia/Sydney";

// The ledger for March 2026 when the API returns no transactions.
async function renderEmptyLedger(
  records: PeriodRecords,
  search: PostingSearch,
  onTestFinished: (cleanup: () => Promise<void>) => void,
) {
  vi.mocked(getReferenceData).mockResolvedValue({
    categories: [],
    counterparties: [],
    tags: [],
    personalEvents: [],
  });
  const root = createRootRoute({
    component: () => (
      <LedgerPage
        search={search}
        period={resolvePeriodKey(YearMonth.make("2026-03"), timezone)}
        records={records}
        timezone={timezone}
        page={{ rows: [], nextCursor: null }}
        accounts={[]}
        navigate={() => {}}
      />
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
    vi.mocked(getReferenceData).mockReset();
  });
}

test("an unfiltered month that no file covers says it has no records yet and offers the upload", async ({
  onTestFinished,
}) => {
  await renderEmptyLedger("missing", {}, onTestFinished);

  await expect.element(page.getByText("No records for March 2026 yet.")).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Upload files" }))
    .toHaveAttribute("href", "/sources");
  await expect
    .element(page.getByRole("button", { name: "Older transactions" }))
    .not.toBeInTheDocument();
});

test("a covered month without transactions says there were none", async ({ onTestFinished }) => {
  await renderEmptyLedger("recorded", {}, onTestFinished);

  await expect.element(page.getByText("No transactions in March 2026.")).toBeVisible();
  await expect.element(page.getByText("No records for March 2026 yet.")).not.toBeInTheDocument();
});

test("an empty filtered ledger blames the filters, even in a month without records", async ({
  onTestFinished,
}) => {
  await renderEmptyLedger("missing", { description: "coffee" }, onTestFinished);

  await expect
    .element(page.getByText("No transactions match. Try another period or fewer filters."))
    .toBeVisible();
  await expect.element(page.getByText("No records for March 2026 yet.")).not.toBeInTheDocument();
});
