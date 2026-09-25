import { type Import, ImportId, Instant, SourceFileId } from "@repo/contracts/finance";
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

import { getImport, listImports, retryImport } from "@/features/imports/functions";
import { FirstUse } from "@/features/overview/first-use";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/imports/functions", () => ({
  listImports: vi.fn<typeof listImports>(),
  getImport: vi.fn<typeof getImport>(),
  retryImport: vi.fn<typeof retryImport>(),
}));

const failed: Import = {
  id: ImportId.make("00000000-0000-4000-8000-000000000001"),
  sourceFileId: SourceFileId.make("00000000-0000-4000-8000-000000000002"),
  accountId: null,
  fileName: "Statement20260831.pdf",
  format: "pdf",
  status: "failed",
  summary: null,
  failure: {
    message: "The file is not a CommBank statement. Upload a PDF statement from NetBank.",
  },
  version: 2,
  createdAt: Instant.make("2026-09-25T00:00:00.000Z"),
};

async function renderFirstUse(imports: readonly Import[]) {
  vi.mocked(listImports).mockResolvedValue({ rows: imports, nextCursor: null });
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <FirstUse timezone="Australia/Sydney" />
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
    vi.mocked(listImports).mockReset();
  };
}

test("before any import the overview says which NetBank files to download and links to Sources to upload", async ({
  onTestFinished,
}) => {
  onTestFinished(await renderFirstUse([]));

  const exports = page.getByRole("region", { name: "Recent transactions, as CSV and OFX" });
  await expect
    .element(
      exports.getByText("Select Export, choose Comma Separated Values (CSV)", { exact: false }),
    )
    .toBeVisible();
  await expect
    .element(exports.getByText("choose Microsoft Money for the OFX file", { exact: false }))
    .toBeVisible();
  await expect.element(exports.getByText("up to 600 transactions", { exact: false })).toBeVisible();
  const statements = page.getByRole("region", { name: "Older history, as PDF statements" });
  await expect
    .element(statements.getByText("choose View accounts, then Statements", { exact: false }))
    .toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Upload files" }))
    .toHaveAttribute("href", "/sources");
  await expect
    .element(page.getByRole("heading", { name: "Your files so far" }))
    .not.toBeInTheDocument();
});

test("a failed first upload is listed with its reason and Retry", async ({ onTestFinished }) => {
  onTestFinished(await renderFirstUse([failed]));

  const files = page.getByRole("region", { name: "Your files so far" });
  await expect.element(files.getByText("Statement20260831.pdf")).toBeVisible();
  await expect
    .element(
      files.getByText("The file is not a CommBank statement. Upload a PDF statement from NetBank."),
    )
    .toBeVisible();
  await expect.element(files.getByRole("button", { name: "Retry import" })).toBeVisible();
});
