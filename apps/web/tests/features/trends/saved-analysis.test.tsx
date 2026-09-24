import { AnalysisId, type SavedAnalysis } from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { contributors } from "@/features/analysis/functions";
import { getAnalysis, listAnalyses } from "@/features/analysis/saved-functions";
import { SavedAnalysisPage } from "@/features/analysis/saved-page";
import { defaultAnalysis } from "@/features/analysis/search";
import { createQueryClient } from "@/lib/query-client";

import { contributorsResult } from "./fixtures";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/analysis/functions", () => ({
  contributors: vi.fn<typeof contributors>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/analysis/saved-functions", () => ({
  getAnalysis: vi.fn<typeof getAnalysis>(),
  listAnalyses: vi.fn<typeof listAnalyses>(),
}));
const analysis: SavedAnalysis = {
  id: AnalysisId.make("00000000-0000-4000-8000-000000000001"),
  name: "Recent delivery",
  definition: { query: defaultAnalysis, groupBy: "counterparty" },
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

test("a saved result stays unchanged until explicit refresh, then shows current data", async ({
  onTestFinished,
}) => {
  let current = contributorsResult(20000n);
  vi.mocked(getAnalysis).mockResolvedValue(analysis);
  vi.mocked(contributors).mockImplementation(async () => current);
  const client = createQueryClient();
  const route = createRootRoute({
    component: () => <SavedAnalysisPage input={{ id: analysis.id }} />,
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
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
  await expect.element(screen.getByRole("heading", { name: "Recent delivery" })).toBeVisible();
  await expect.element(screen.getByText("200.00 AUD").first()).toBeVisible();
  current = contributorsResult(30000n);
  await client.invalidateQueries();
  await expect.element(screen.getByText("200.00 AUD").first()).toBeVisible();
  await screen.getByRole("button", { name: "Refresh analysis" }).click();
  await expect.element(screen.getByText("300.00 AUD").first()).toBeVisible();
});
