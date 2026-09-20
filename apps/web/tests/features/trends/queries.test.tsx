import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { contributors, overview, rows } from "@/features/analysis/functions";
import { formatMetric } from "@/features/analysis/labels";
import { contributorsQuery } from "@/features/analysis/queries";
import { defaultAnalysis } from "@/features/analysis/search";
import { createQueryClient } from "@/lib/query-client";

import { contributorsResult } from "./fixtures";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/analysis/functions", () => ({
  contributors: vi.fn<typeof contributors>(),
  overview: vi.fn<typeof overview>(),
  rows: vi.fn<typeof rows>(),
}));

const options = contributorsQuery({ query: defaultAnalysis, groupBy: "merchant" });
function ResultView() {
  const { data, isFetching } = useSuspenseQuery(options);
  return (
    <output>{isFetching ? "Calculating" : formatMetric(data.comparison.current.value)}</output>
  );
}

test("a delayed mount keeps its loaded result and a new load reads current records", async ({
  onTestFinished,
}) => {
  let current = contributorsResult(20000n);
  vi.mocked(contributors).mockImplementation(async () => current);
  const client = createQueryClient();
  const loaded = await client.fetchQuery(options);
  client.setQueryData(options.queryKey, loaded, { updatedAt: Date.now() - 2000 });
  current = contributorsResult(30000n);
  const view = (
    <QueryClientProvider client={client}>
      <ResultView />
    </QueryClientProvider>
  );
  let screen = await render(view);
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.resetAllMocks();
  });
  await expect.element(screen.getByRole("status")).toHaveTextContent("200.00 AUD");
  await screen.unmount();
  await client.fetchQuery(options);
  screen = await render(view);
  await expect.element(screen.getByRole("status")).toHaveTextContent("300.00 AUD");
});
