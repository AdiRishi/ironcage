import { QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Suspense } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { createAccount, listAccounts, updateAccount } from "@/features/accounts/functions";
import { listExports, requestExport } from "@/features/exports/functions";
import { getImport, listImports, retryImport } from "@/features/imports/functions";
import { getPosting, listCountedLedger, listLedger } from "@/features/ledger/functions";
import { listSourceFiles, removeSourceBytes } from "@/features/sources/functions";
import { SourcesPage } from "@/features/sources/page";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/accounts/functions", () => ({
  listAccounts: vi.fn<typeof listAccounts>(),
  createAccount: vi.fn<typeof createAccount>(),
  updateAccount: vi.fn<typeof updateAccount>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/exports/functions", () => ({
  listExports: vi.fn<typeof listExports>(),
  requestExport: vi.fn<typeof requestExport>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/imports/functions", () => ({
  listImports: vi.fn<typeof listImports>(),
  getImport: vi.fn<typeof getImport>(),
  retryImport: vi.fn<typeof retryImport>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/ledger/functions", () => ({
  getPosting: vi.fn<typeof getPosting>(),
  listCountedLedger: vi.fn<typeof listCountedLedger>(),
  listLedger: vi.fn<typeof listLedger>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/sources/functions", () => ({
  listSourceFiles: vi.fn<typeof listSourceFiles>(),
  removeSourceBytes: vi.fn<typeof removeSourceBytes>(),
}));

// Sources before any file has been uploaded.
async function renderSources() {
  vi.mocked(listAccounts).mockResolvedValue([]);
  vi.mocked(listSourceFiles).mockResolvedValue([]);
  vi.mocked(listExports).mockResolvedValue([]);
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <SourcesPage coverage={[]} imports={[]} timezone="Australia/Sydney" />
      </Suspense>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(listAccounts).mockReset();
    vi.mocked(listSourceFiles).mockReset();
    vi.mocked(listExports).mockReset();
  };
}

test("which files to download from NetBank stays folded on Sources until you open it", async ({
  onTestFinished,
}) => {
  onTestFinished(await renderSources());

  const toggle = page.getByRole("button", { name: "Which files to download from NetBank" });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .element(page.getByRole("region", { name: "Recent transactions, as CSV and OFX" }))
    .not.toBeInTheDocument();

  await toggle.click();
  await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
  const exports = page.getByRole("region", { name: "Recent transactions, as CSV and OFX" });
  await expect.element(exports.getByText("up to 600 transactions", { exact: false })).toBeVisible();
  await expect
    .element(page.getByRole("region", { name: "Older history, as PDF statements" }))
    .toBeVisible();
});

test("with no files yet, Sources asks for NetBank exports and statements", async ({
  onTestFinished,
}) => {
  onTestFinished(await renderSources());

  await expect
    .element(
      page
        .getByRole("region", { name: "Files" })
        .getByText("No files yet. Upload your NetBank exports and statements above."),
    )
    .toBeVisible();
});
