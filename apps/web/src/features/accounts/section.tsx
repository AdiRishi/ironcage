import type { Account } from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";

import { CreateAccountDialog } from "./create-account";
import { EditAccountDialog } from "./edit-account";
import { accountKindLabels } from "./labels";

export function AccountsSection({ accounts }: { accounts: readonly Account[] }) {
  return (
    <section aria-labelledby="accounts-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h2 id="accounts-heading" className="type-heading">
          Accounts
        </h2>
        <CreateAccountDialog />
      </div>
      {accounts.length === 0 ? (
        <p className="max-w-[72ch] text-slate">
          No accounts yet. Uploading an OFX file or a statement on{" "}
          <Link to="/sources" className="text-intaglio underline underline-offset-4">
            Sources
          </Link>{" "}
          adds its account. Add one here only for a CSV you upload first.
        </p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="font-[560]">{account.label}</p>
                <p className="type-small text-slate">
                  {accountKindLabels[account.kind]} · {account.currency}
                  {account.accountNumber &&
                    ` · ${account.bankId ? `${account.bankId} ` : ""}${account.accountNumber}`}
                </p>
              </div>
              <EditAccountDialog account={account} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
