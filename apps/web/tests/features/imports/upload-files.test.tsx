import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { listAccounts, createAccount } from "@/features/accounts/functions";
import { accountsQueryOptions } from "@/features/accounts/queries";
import { UploadFiles } from "@/features/imports/upload-files";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/accounts/functions", () => ({
  listAccounts: vi.fn<typeof listAccounts>(),
  createAccount: vi.fn<typeof createAccount>(),
}));

test("an invalid upload response fails that file while a sibling completes and messages can be dismissed", async ({
  onTestFinished,
}) => {
  vi.mocked(listAccounts).mockResolvedValue([]);
  const fetch = globalThis.fetch;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (input !== "/uploads") return fetch(input, init);
    const file = init?.body instanceof FormData ? init.body.get("file") : null;
    if (!(file instanceof File)) throw new Error("Expected an uploaded file.");
    return Response.json(
      file.name === "bad.csv"
        ? { unexpected: true }
        : {
            importId: "00000000-0000-4000-8000-000000000001",
            sourceFileId: "00000000-0000-4000-8000-000000000002",
            existing: false,
          },
    );
  });
  const client = createQueryClient();
  client.setQueryData(accountsQueryOptions().queryKey, []);
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: createRootRoute({ component: UploadFiles }),
  });
  await router.load();
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    transport.mockRestore();
    vi.mocked(listAccounts).mockReset();
  });

  await screen
    .getByLabelText("Choose bank files")
    .upload([
      new File(["invalid"], "bad.csv", { type: "text/csv" }),
      new File(["02/09/2026,-4.50,Coffee,100.00\n"], "good.csv", { type: "text/csv" }),
    ]);
  await expect
    .element(screen.getByText("Upload did not finish. Choose the file again to retry."))
    .toBeVisible();
  await expect
    .element(screen.getByRole("link", { name: "View import" }))
    .toHaveAttribute("href", "/sources/imports/00000000-0000-4000-8000-000000000001");
  await screen.getByRole("button", { name: "Dismiss upload messages" }).click();
  await expect.element(screen.getByText("bad.csv")).not.toBeInTheDocument();
  await expect.element(screen.getByText("good.csv")).not.toBeInTheDocument();
});
