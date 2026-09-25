import { type MonthlyFlow, YearMonth } from "@repo/contracts/finance";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { PeriodStrip } from "@/components/shell/period-strip";
import { resolvePeriodKey } from "@/lib/period";

const money = (minor: bigint) => ({ currency: "AUD", minor });
const months = ["2026-06", "2026-07", "2026-08", "2026-09"].map((month) => ({
  month: YearMonth.make(month),
  inflow: money(500000n),
  outflow: money(400000n),
  spending: money(300000n),
  coverage: "complete" as const,
}));
// The second page of July's loan principal, as the ledger writes it.
const cursor = encodeURIComponent(
  JSON.stringify({ part: 0, on: "2026-07-10", id: "00000000-0000-4000-8000-000000000050" }),
);

// The strip with July selected. Without `?period=` in the address, July stands for the
// current month the screens read when no period is chosen.
async function renderStrip({
  address = `/ledger?measure=loanPrincipal&period=2026-07&cursor=${cursor}`,
  measure = "outflow",
  drawn = months,
}: {
  address?: string;
  measure?: "outflow" | "spending";
  drawn?: typeof MonthlyFlow.Type;
} = {}) {
  const root = createRootRoute();
  const ledger = createRoute({
    getParentRoute: () => root,
    path: "/ledger",
    component: () => (
      <PeriodStrip
        months={drawn}
        period={resolvePeriodKey(YearMonth.make("2026-07"), "Australia/Sydney")}
        measure={measure}
      />
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([ledger]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const screen = await render(<RouterProvider router={router} />);
  return { router, screen };
}

test("choosing another month keeps the records open but starts them from the first page", async ({
  onTestFinished,
}) => {
  const { router, screen } = await renderStrip();
  onTestFinished(() => screen.unmount());

  await page.getByRole("link", { name: /^August 2026/ }).click();

  await expect
    .poll(() => router.state.location.search)
    .toEqual({ measure: "loanPrincipal", period: "2026-08" });
});

test("choosing a year writes it as a bare year", async ({ onTestFinished }) => {
  const { router, screen } = await renderStrip();
  onTestFinished(() => screen.unmount());

  await page.getByRole("link", { name: "2026", exact: true }).click();

  await expect
    .poll(() => router.state.location.searchStr)
    .toBe("?measure=loanPrincipal&period=2026");
});

test("the selected month is announced as current even when the address names no period", async ({
  onTestFinished,
}) => {
  const { screen } = await renderStrip({ address: "/ledger" });
  onTestFinished(() => screen.unmount());

  await expect
    .element(page.getByRole("link", { name: /^July 2026/ }))
    .toHaveAttribute("aria-current");
  await expect
    .element(page.getByRole("link", { name: /^August 2026/ }))
    .not.toHaveAttribute("aria-current");
});

test("on spending each month reads what was spent, and a month without records says so", async ({
  onTestFinished,
}) => {
  const { screen } = await renderStrip({
    measure: "spending",
    drawn: months.map((month) =>
      month.month === "2026-06" ? { ...month, coverage: "missing" as const } : month,
    ),
  });
  onTestFinished(() => screen.unmount());

  await expect
    .element(page.getByRole("link", { name: "July 2026, $3,000 spent", exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "June 2026, no records", exact: true }))
    .toBeVisible();
});
