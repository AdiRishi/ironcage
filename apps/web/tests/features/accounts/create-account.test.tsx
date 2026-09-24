import { AccountId, type Account } from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { CreateAccountDialog } from "@/features/accounts/create-account";
import { createAccount } from "@/features/accounts/functions";
import { AppRequestError } from "@/lib/app-error";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- The server function is the remote transport boundary.
vi.mock("../../../src/features/accounts/functions", () => ({
  createAccount: vi.fn<typeof createAccount>(),
}));

test("reopening a pending account dialog preserves safe retry after a lost response", async ({
  onTestFinished,
}) => {
  const response = Promise.withResolvers<void>();
  const receipts = new Map<string, Account>();
  const records: Account[] = [];
  vi.mocked(createAccount).mockImplementation(async ({ data }) => {
    const receipt = receipts.get(data.commandId);
    if (receipt) return receipt;
    const account: Account = {
      id: AccountId.make("00000000-0000-4000-8000-000000000001"),
      label: data.label,
      kind: data.kind,
      institution: data.institution,
      currency: data.currency,
      bankId: null,
      accountNumber: null,
      version: 1,
    };
    records.push(account);
    receipts.set(data.commandId, account);
    await response.promise;
    throw new AppRequestError("unavailable", "The connection was lost.");
  });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <CreateAccountDialog />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    response.resolve();
    await screen.unmount();
    client.clear();
    vi.mocked(createAccount).mockReset();
  });

  await page.getByRole("button", { name: "Add account", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Account name" }).fill("Everyday");
  await dialog.getByRole("button", { name: "Add account", exact: true }).click();
  await expect.element(dialog.getByRole("button", { name: "Adding account…" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Add account", exact: true }).click();
  await expect.element(dialog.getByRole("button", { name: "Adding account…" })).toBeDisabled();
  await expect
    .element(dialog.getByRole("textbox", { name: "Account name" }))
    .toHaveValue("Everyday");

  response.resolve();
  await expect.element(dialog.getByRole("alert")).toHaveTextContent("The connection was lost.");
  await dialog.getByRole("button", { name: "Retry add account" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(records.map((account) => account.label)).toEqual(["Everyday"]);
});
