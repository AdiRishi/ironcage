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

import { createAccount, listAccounts, updateAccount } from "@/features/accounts/functions";
import { AccountsSection } from "@/features/accounts/section";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/accounts/functions", () => ({
  listAccounts: vi.fn<typeof listAccounts>(),
  createAccount: vi.fn<typeof createAccount>(),
  updateAccount: vi.fn<typeof updateAccount>(),
}));

test("before any account exists, Settings sends you to Sources, where a statement or OFX file adds it", async ({
  onTestFinished,
}) => {
  const client = createQueryClient();
  const router = createRouter({
    routeTree: createRootRoute({ component: () => <AccountsSection accounts={[]} /> }),
    history: createMemoryHistory(),
  });
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
  });

  const accounts = page.getByRole("region", { name: "Accounts" });
  await expect
    .element(accounts.getByText("No accounts yet.", { exact: false }))
    .toHaveTextContent(
      "No accounts yet. Uploading an OFX file or a statement on Sources adds its account. Add one here only for a CSV you upload first.",
    );
  await expect
    .element(accounts.getByRole("link", { name: "Sources" }))
    .toHaveAttribute("href", "/sources");
});
