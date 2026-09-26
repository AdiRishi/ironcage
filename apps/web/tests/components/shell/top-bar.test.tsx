import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { TopBar } from "@/components/shell/top-bar";

async function renderBar(width: number, onTestFinished: (cleanup: () => Promise<void>) => void) {
  await page.viewport(width, 812);
  await document.fonts.load('0.9375rem "Archivo Variable"');
  const root = createRootRoute({ component: () => <TopBar questionCount={187} /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const screen = await render(<RouterProvider router={router} />);
  onTestFinished(() => screen.unmount());
}

// Whether the bar's row and the page are as wide as the window, or narrower.
const fits = (width: number) => {
  const bar = page.getByRole("banner").element().firstElementChild;
  return (
    (bar?.scrollWidth ?? Infinity) <= (bar?.clientWidth ?? 0) &&
    document.documentElement.scrollWidth <= width
  );
};

test("the top bar fits a 375 pixel phone with a three-digit question count", async ({
  onTestFinished,
}) => {
  await renderBar(375, onTestFinished);

  await expect.element(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  expect(fits(375)).toBe(true);
});

test("the top bar keeps its destinations in the menu until they all fit beside it", async ({
  onTestFinished,
}) => {
  await renderBar(768, onTestFinished);
  await expect.element(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  expect(fits(768)).toBe(true);

  await page.viewport(1024, 812);
  await expect.element(page.getByRole("link", { name: "Analyst" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
  expect(fits(1024)).toBe(true);
});

test("the open screen is marked with an Intaglio rule and ink, and the others in Slate", async ({
  onTestFinished,
}) => {
  await renderBar(1280, onTestFinished);

  const main = page.getByRole("navigation", { name: "Main" });
  const open = main.getByRole("link", { name: "Overview" });
  await expect.element(open).toHaveAttribute("aria-current", "page");
  const styleOf = (link: typeof open) => getComputedStyle(link.element());
  expect(styleOf(open)).toMatchObject({
    borderBottomColor: "rgb(22, 50, 58)",
    color: "rgb(22, 50, 58)",
  });
  expect(styleOf(main.getByRole("link", { name: "Spending" }))).toMatchObject({
    borderBottomColor: "rgba(0, 0, 0, 0)",
    color: "rgb(90, 106, 110)",
  });
});
