import type { PeriodFlow } from "@repo/contracts/finance";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { FlowDiagram } from "@/features/overview/flow-diagram";

import { august, food, salary, travel } from "./period-flow";

async function renderFlow(flow: PeriodFlow, width: number) {
  await page.viewport(width, 900);
  // The diagram measures its labels again once the web font loads, and Recharts redraws
  // every node when the margins move. Loading it first keeps focus on the node it is on.
  await document.fonts.load('0.875rem "Archivo Variable"');
  const root = createRootRoute();
  const overview = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <FlowDiagram flow={flow} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([overview]),
    history: createMemoryHistory(),
  });
  return render(<RouterProvider router={router} />);
}

const link = (name: string) => page.getByRole("link", { name, exact: true });

test("every stream in the diagram is a link named with its amount", async ({ onTestFinished }) => {
  const screen = await renderFlow(august, 1280);
  onTestFinished(() => screen.unmount());

  await expect
    .element(link("Salary, $8,500 came in"))
    .toHaveAttribute("href", `/ledger?measure=income&category=${salary}`);
  await expect.element(link("From your other accounts, $500 came in")).toBeVisible();
  await expect.element(link("Travel, net money back, $300 came in")).toBeVisible();
  await expect.element(link("Housing, $1,840 went out")).toBeVisible();
  await expect
    .element(link("Food, $620 went out"))
    .toHaveAttribute("href", `/spending?category=${food}`);
  await expect
    .element(link("Loan principal, $1,100 went out"))
    .toHaveAttribute("href", "/ledger?measure=loanPrincipal");
  await expect.element(link("To your other accounts, $2,000 went out")).toBeVisible();
  // The phone bars follow the diagram in the page, hidden at this width.
  await expect.element(page.getByText("Kept", { exact: true }).first()).toBeVisible();
  await expect.element(page.getByRole("link", { name: /Kept/ })).not.toBeInTheDocument();
});

test("the keyboard moves from the table switch straight through the streams", async ({
  onTestFinished,
}) => {
  const screen = await renderFlow(august, 1280);
  onTestFinished(() => screen.unmount());
  await expect.element(link("Salary, $8,500 came in")).toBeVisible();

  page.getByRole("button", { name: "Show as a table" }).element().focus();
  const reached: string[] = [];
  for (let step = 0; step < 7; step++) {
    await userEvent.tab();
    reached.push(document.activeElement?.getAttribute("aria-label") ?? "");
  }

  expect(reached).toEqual([
    "Salary, $8,500 came in",
    "From your other accounts, $500 came in",
    "Travel, net money back, $300 came in",
    "Housing, $1,840 went out",
    "Food, $620 went out",
    "Loan principal, $1,100 went out",
    "To your other accounts, $2,000 went out",
  ]);
});

test("on a phone the stacked bars open the same records", async ({ onTestFinished }) => {
  const screen = await renderFlow(august, 390);
  onTestFinished(() => screen.unmount());

  await expect
    .element(link("Food, $620 went out"))
    .toHaveAttribute("href", `/spending?category=${food}`);
  await expect
    .element(link("Loan principal, $1,100 went out"))
    .toHaveAttribute("href", "/ledger?measure=loanPrincipal");
  await expect.element(page.getByText("What came in less what went out")).toBeVisible();
  await expect.element(page.getByRole("link", { name: /Kept/ })).not.toBeInTheDocument();
});

test("the table view lists every stream as a link and Kept as text", async ({ onTestFinished }) => {
  const screen = await renderFlow(august, 1280);
  onTestFinished(() => screen.unmount());

  await page.getByRole("button", { name: "Show as a table" }).click();

  const table = page.getByRole("table", { name: "Money in and out" });
  await expect
    .element(table.getByRole("link", { name: "Food, $620 went out", exact: true }))
    .toHaveAttribute("href", `/spending?category=${food}`);
  await expect
    .element(table.getByRole("link", { name: "Loan principal, $1,100 went out" }))
    .toHaveAttribute("href", "/ledger?measure=loanPrincipal");
  await expect.element(table.getByRole("rowheader", { name: /^Kept/ })).toBeVisible();
  await expect.element(table.getByRole("link", { name: /Kept/ })).not.toBeInTheDocument();
});

test("streams with the same name on both sides say which way the money went", async ({
  onTestFinished,
}) => {
  const uncategorised = (measure: "income" | "spending", minor: bigint) =>
    ({
      kind: measure === "income" ? "income" : "uncategorised",
      key: `${measure}:uncategorised`,
      label: "Not yet categorised",
      scope: { measure, category: { kind: "uncategorised" }, counterparty: { kind: "all" } },
      amount: { currency: "AUD", minor },
      previous: { currency: "AUD", minor: 0n },
      modelAmount: { currency: "AUD", minor: 0n },
    }) as const;
  const screen = await renderFlow(
    {
      ...august,
      inflows: [...august.inflows, uncategorised("income", 12000n)],
      outflows: [...august.outflows, uncategorised("spending", 12000n)],
    },
    1280,
  );
  onTestFinished(() => screen.unmount());

  await page.getByRole("button", { name: "Show as a table" }).click();

  const table = page.getByRole("table", { name: "Money in and out" });
  await expect
    .element(table.getByRole("link", { name: "Not yet categorised, $120 came in" }))
    .toHaveAttribute("href", "/ledger?measure=income&category=uncategorised");
  await expect
    .element(table.getByRole("link", { name: "Not yet categorised, $120 went out" }))
    .toHaveAttribute("href", "/ledger?measure=spending&category=uncategorised");
});

test("the summary counts only the sources of what came in, and names money back", async ({
  onTestFinished,
}) => {
  const screen = await renderFlow(august, 1280);
  onTestFinished(() => screen.unmount());

  await expect
    .element(
      page.getByText(
        "$9,000 came in from 2 sources, and $5,260 went out to 4 destinations after $300 in Travel came back.",
        { exact: true },
      ),
    )
    .toBeVisible();
});

test("a long label on either side stays inside the diagram", async ({ onTestFinished }) => {
  const fees = {
    ...august,
    outflows: august.outflows.map((stream) =>
      stream.kind === "category" && stream.categoryId === travel
        ? { ...stream, label: "Fees and interest", amount: { currency: "AUD", minor: -2500n } }
        : stream,
    ),
  };
  const screen = await renderFlow(fees, 900);
  onTestFinished(() => screen.unmount());

  const inside = (name: string) => {
    const label = link(name).query()?.querySelector("text");
    const diagram = label?.closest("svg")?.getBoundingClientRect();
    const drawn = label?.getBoundingClientRect();
    return Boolean(drawn && diagram && drawn.left >= diagram.left && drawn.right <= diagram.right);
  };
  await expect.poll(() => inside("Fees and interest, net money back, $25 came in")).toBe(true);
  await expect.poll(() => inside("To your other accounts, $2,000 went out")).toBe(true);
});
