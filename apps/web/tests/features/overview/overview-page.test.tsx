import {
  AccountId,
  type AccountCoverage,
  CalendarDate,
  type PeriodFlow,
  YearMonth,
} from "@repo/contracts/finance";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { OverviewPage } from "@/features/overview/page";
import { resolvePeriodKey } from "@/lib/period";

import { august, food } from "./period-flow";

const money = (minor: bigint) => ({ currency: "AUD", minor });
const days = (start: string, endExclusive: string) => ({
  start: CalendarDate.make(start),
  endExclusive: CalendarDate.make(endExclusive),
});
const records = (
  n: number,
  kind: AccountCoverage["account"]["kind"],
  label: string,
  observed: AccountCoverage["observed"],
): AccountCoverage => ({
  account: {
    id: AccountId.make(`20000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
    kind,
    label,
    currency: "AUD",
  },
  observed,
  reconciled: [],
  missing: [],
  latestImportAt: null,
});

const show = async (flow: PeriodFlow, onTestFinished: (cleanup: () => Promise<void>) => void) => {
  const root = createRootRoute({
    component: () => (
      <OverviewPage
        flow={flow}
        period={resolvePeriodKey(YearMonth.make("2026-08"), "Australia/Sydney")}
        compare={undefined}
        onCompare={() => {}}
        firstMonth={YearMonth.make("2026-06")}
        today={CalendarDate.make("2026-09-25")}
        questions={{
          period: flow.period,
          count: 0,
          byFilter: { who: 0, people: 0, accounts: 0, rules: 0 },
          outflow: money(0n),
          inflow: money(0n),
        }}
      />
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  const screen = await render(<RouterProvider router={router} />);
  onTestFinished(() => screen.unmount());
};

test("the overview names each account missing days of the period", async ({ onTestFinished }) => {
  // The everyday account has every day of August, and the card's statements skip 11 to
  // 31 August.
  await show(
    {
      ...august,
      coverage: [
        records(1, "deposit", "Everyday", [days("2026-06-01", "2026-09-26")]),
        records(2, "card", "Everyday card", [
          days("2026-06-01", "2026-08-11"),
          days("2026-09-01", "2026-09-26"),
        ]),
      ],
    },
    onTestFinished,
  );

  await expect
    .element(
      page.getByText(
        "Everyday card has no records for 11 to 31 August 2026, so August 2026 is incomplete.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByText(/^Everyday has no records/)).not.toBeInTheDocument();
});

test("What changed keeps the cents of a change under a dollar", async ({ onTestFinished }) => {
  // Coffee fell by 40 cents to $3.
  await show(
    {
      ...august,
      previousTotals: august.totals,
      coverage: [records(1, "deposit", "Everyday", [days("2026-06-01", "2026-09-26")])],
      changes: [
        {
          category: { kind: "category", id: food },
          label: "Coffee",
          parentLabel: "Food",
          current: money(300n),
          previous: money(340n),
          change: money(-40n),
          percentChange: -12,
          purchases: 1,
          previousPurchases: 1,
          averagePurchase: money(300n),
          previousAveragePurchase: money(340n),
          purchasesPart: money(0n),
          averagePart: money(-40n),
          otherPart: money(0n),
        },
      ],
    },
    onTestFinished,
  );

  await expect
    .element(page.getByRole("link", { name: /Coffee fell \$0\.40 to \$3\./ }))
    .toBeVisible();
});
