import { AccountId, type Account } from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { EditAccountDialog } from "@/features/accounts/edit-account";
import { listAccounts, updateAccount } from "@/features/accounts/functions";
import { accountsQueryOptions } from "@/features/accounts/queries";
import { AppRequestError } from "@/lib/app-error";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/accounts/functions", () => ({
  listAccounts: vi.fn<typeof listAccounts>(),
  updateAccount: vi.fn<typeof updateAccount>(),
}));

function AccountEditor() {
  const { data } = useSuspenseQuery(accountsQueryOptions());
  return data.map((account) => <EditAccountDialog key={account.id} account={account} />);
}

test("a background refresh cannot overwrite an account until the current record is reviewed", async ({
  onTestFinished,
}) => {
  let stored: Account = {
    id: AccountId.make("00000000-0000-4000-8000-000000000001"),
    label: "Everyday",
    kind: "deposit",
    currency: "AUD",
    bankId: null,
    accountNumber: null,
    version: 1,
  };
  vi.mocked(listAccounts).mockImplementation(async () => [stored]);
  vi.mocked(updateAccount).mockImplementation(async ({ data }) => {
    if (data.expectedVersion !== stored.version)
      throw new AppRequestError("stale", "Account changed. Refresh before saving.");
    stored = { ...stored, label: data.label, kind: data.kind, version: stored.version + 1 };
    return stored;
  });
  const client = createQueryClient();
  client.setQueryData(accountsQueryOptions().queryKey, [stored]);
  const screen = await render(
    <QueryClientProvider client={client}>
      <AccountEditor />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(listAccounts).mockReset();
    vi.mocked(updateAccount).mockReset();
  });

  await page.getByRole("button", { name: "Edit Everyday" }).click();
  const dialog = page.getByRole("dialog");
  const label = dialog.getByRole("textbox", { name: "Account name" });
  await label.fill("Household");
  stored = { ...stored, label: "Joint account", version: 2 };
  await client.invalidateQueries({ queryKey: accountsQueryOptions().queryKey });
  await dialog.getByRole("button", { name: "Save account" }).click();
  await expect
    .element(dialog.getByRole("alert"))
    .toMatchTextContent("Current account: Joint account · Deposit.");
  expect(stored.label).toBe("Joint account");
  await expect.element(label).toHaveValue("Household");

  await dialog.getByRole("button", { name: "Keep my edits" }).click();
  await dialog.getByRole("button", { name: "Save account" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  expect(stored.label).toBe("Household");

  await page.getByRole("button", { name: "Edit Household" }).click();
  await expect.element(label).toHaveValue("Household");
});
