import { useSuspenseQuery } from "@tanstack/react-query";

import { CreateAccountDialog } from "@/features/accounts/create-account";
import { EditAccountDialog } from "@/features/accounts/edit-account";
import { accountsQueryOptions } from "@/features/accounts/queries";

import { DisplaySettings } from "./display-settings";
import { settingsQueryOptions, retentionQueryOptions } from "./queries";

export function SettingsPage() {
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  const { data: retention } = useSuspenseQuery(retentionQueryOptions());
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  return (
    <div className="max-w-4xl space-y-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-2 text-muted-foreground">Accounts, display preferences, and your data.</p>
      </header>
      <section className="space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">Accounts</h2>
          <CreateAccountDialog />
        </div>
        {accounts.length === 0 ? (
          <p className="rounded-lg border p-5 text-muted-foreground">
            Import an OFX file or add an account to begin.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium">{account.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {account.kind === "card"
                      ? "Credit card"
                      : account.kind === "loan"
                        ? "Loan"
                        : "Deposit"}{" "}
                    · {account.currency}
                  </p>
                  {account.accountNumber && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {account.bankId ? `${account.bankId} · ` : ""}
                      {account.accountNumber}
                    </p>
                  )}
                </div>
                <EditAccountDialog account={account} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-5 rounded-lg border p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Display</h2>
        <DisplaySettings settings={settings} />
      </section>
      <section className="space-y-3 rounded-lg border p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Backups and original files</h2>
        <p className="text-sm text-muted-foreground">{retention.database}</p>
        <p className="text-sm break-words text-muted-foreground">{retention.originals}</p>
        <p className="text-sm text-muted-foreground">
          Removing live data does not remove it from retained backups.
        </p>
      </section>
    </div>
  );
}
