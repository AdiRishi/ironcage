import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Landmark } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { CreateAccountDialog } from "@/features/accounts/create-account";
import { accountKindLabels } from "@/features/accounts/labels";
import { accountsQueryOptions } from "@/features/accounts/queries";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(accountsQueryOptions()),
  component: Home,
});

function Home() {
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          {accounts.length === 0 ? "Start with your bank history." : "Your bank history"}
        </h1>
        <p className="mt-3 text-muted-foreground">
          Your accounts and their supporting bank records, together.
        </p>
      </header>
      <Button render={<Link to="/imports" />}>Import bank files</Button>
      <section className="rounded-lg border bg-card p-6" aria-labelledby="accounts-heading">
        <div className="flex items-center justify-between gap-3">
          <h2 id="accounts-heading" className="text-xl font-semibold">
            Accounts
          </h2>
          <CreateAccountDialog />
        </div>
        {accounts.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Landmark />
              </EmptyMedia>
              <EmptyTitle>No accounts yet</EmptyTitle>
              <EmptyDescription>Your bank history starts with an account.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {accounts.map((account) => (
              <li key={account.id} className="flex justify-between py-4">
                <span>{account.label}</span>
                <span>
                  {accountKindLabels[account.kind]} · {account.currency}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
