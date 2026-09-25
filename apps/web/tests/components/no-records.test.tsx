import { YearMonth } from "@repo/contracts/finance";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { NoRecords } from "@/components/no-records";
import { resolvePeriodKey } from "@/lib/period";

const timezone = "Australia/Sydney";

async function renderNoRecords(props: Parameters<typeof NoRecords>[0]) {
  const root = createRootRoute({ component: () => <NoRecords {...props} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  return render(<RouterProvider router={router} />);
}

test("a past month without records asks for its statements and links to Sources", async ({
  onTestFinished,
}) => {
  vi.useFakeTimers({ now: Date.parse("2026-09-15T00:00:00Z"), toFake: ["Date"] });
  const screen = await renderNoRecords({
    records: "missing",
    period: resolvePeriodKey(YearMonth.make("2026-03"), timezone),
    timezone,
  });
  onTestFinished(async () => {
    await screen.unmount();
    vi.useRealTimers();
  });

  await expect.element(page.getByText("No records for March 2026 yet.")).toBeVisible();
  await expect.element(page.getByText("Upload the March 2026 statements.")).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Upload files" }))
    .toHaveAttribute("href", "/sources");
});

test("the month in progress asks for its exports so far", async ({ onTestFinished }) => {
  vi.useFakeTimers({ now: Date.parse("2026-09-15T00:00:00Z"), toFake: ["Date"] });
  const screen = await renderNoRecords({
    records: "missing",
    period: resolvePeriodKey(YearMonth.make("2026-09"), timezone),
    timezone,
  });
  onTestFinished(async () => {
    await screen.unmount();
    vi.useRealTimers();
  });

  await expect
    .element(
      page.getByText("Export September 2026 so far from NetBank as CSV and OFX, then upload both."),
    )
    .toBeVisible();
});

test("before any import, a period screen points to the overview's download guide", async ({
  onTestFinished,
}) => {
  const screen = await renderNoRecords({
    records: "none",
    period: resolvePeriodKey(YearMonth.make("2026-03"), timezone),
    timezone,
  });
  onTestFinished(() => screen.unmount());

  await expect.element(page.getByText("No records yet.")).toBeVisible();
  await expect.element(page.getByRole("link", { name: "overview" })).toHaveAttribute("href", "/");
  await expect
    .element(page.getByRole("link", { name: "Upload files" }))
    .toHaveAttribute("href", "/sources");
});
