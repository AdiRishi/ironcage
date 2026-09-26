import { type FlowDirection, YearMonth } from "@repo/contracts/finance";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, type TestContext, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { CounterpartiesPage } from "@/features/counterparties/list";
import { resolvePeriodKey } from "@/lib/period";

async function renderEmptyTab(
  direction: FlowDirection,
  moneyMoved: boolean,
  onTestFinished: TestContext["onTestFinished"],
) {
  const root = createRootRoute({
    component: () => (
      <CounterpartiesPage
        counterparties={[]}
        references={{ categories: [], counterparties: [], tags: [], personalEvents: [] }}
        period={resolvePeriodKey(YearMonth.make("2026-03"), "Australia/Sydney")}
        direction={direction}
        moneyMoved={moneyMoved}
        search=""
        onSearch={() => {}}
        onDirection={() => {}}
      />
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  const screen = await render(<RouterProvider router={router} />);
  onTestFinished(() => screen.unmount());
}

test("money out with no identified counterparties points to identification and Questions", async ({
  onTestFinished,
}) => {
  await renderEmptyTab("out", true, onTestFinished);

  const panel = page.getByRole("tabpanel", { name: "Money out" });
  await expect
    .element(panel)
    .toHaveTextContent(
      "Ironcage has not identified anyone you paid in March 2026. Run counterparty identification in Settings, or answer Questions.",
    );
  await expect
    .element(panel.getByRole("link", { name: "Settings" }))
    .toHaveAttribute("href", "/settings#identification");
  await expect
    .element(panel.getByRole("link", { name: "Questions" }))
    .toHaveAttribute("href", "/questions");
});

test("a month where nothing came in says so instead of asking for identification", async ({
  onTestFinished,
}) => {
  await renderEmptyTab("in", false, onTestFinished);

  const panel = page.getByRole("tabpanel", { name: "Money in" });
  await expect.element(panel).toHaveTextContent("Nothing came in during March 2026.");
  await expect.element(panel.getByRole("link")).not.toBeInTheDocument();
});
