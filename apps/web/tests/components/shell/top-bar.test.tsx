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

test("the top bar fits a 375 pixel phone with a three-digit question count", async ({
  onTestFinished,
}) => {
  await page.viewport(375, 812);
  await document.fonts.load('0.9375rem "Archivo Variable"');
  const root = createRootRoute({ component: () => <TopBar questionCount={187} /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const screen = await render(<RouterProvider router={router} />);
  onTestFinished(() => screen.unmount());

  await expect.element(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  const bar = page.getByRole("banner").element().firstElementChild;
  expect(bar?.scrollWidth).toBeLessThanOrEqual(bar?.clientWidth ?? 0);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
});
