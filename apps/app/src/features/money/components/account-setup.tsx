import type { BankAccountSummary } from "@ironcage/contracts/schema";
import type { BankAccountType } from "@ironcage/domain";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Button } from "@ironcage/ui/components/button";
import { Spinner } from "@ironcage/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon } from "lucide-react";

import { keys } from "@/data/keys";
import { mintRequestId } from "@/data/request";
import { describeError } from "@/features/money/format";
import { decodeAccountOutcome } from "@/features/money/transport";
import { configureBankAccount } from "@/server/money";

/**
 * The four accounts the first release follows, from `docs/product/05-money.md`
 * — decided there, so setup is one click rather than a form. Identity binds
 * on each account's first confirmed import.
 */
const STANDARD_ACCOUNTS: ReadonlyArray<{
  readonly productLabel: string;
  readonly accountType: BankAccountType;
}> = [
  { productLabel: "Spending offset", accountType: "deposit" },
  { productLabel: "Savings offset", accountType: "deposit" },
  { productLabel: "Mastercard", accountType: "credit_card" },
  { productLabel: "Home loan", accountType: "credit_line" },
];

export function AccountSetup({ existing }: { readonly existing: readonly BankAccountSummary[] }) {
  const queryClient = useQueryClient();
  const missing = STANDARD_ACCOUNTS.filter(
    (standard) => !existing.some((account) => account.productLabel === standard.productLabel),
  );

  const setup = useMutation({
    mutationFn: async () => {
      for (const account of missing) {
        const outcome = decodeAccountOutcome(
          await configureBankAccount({
            data: {
              requestId: mintRequestId(),
              productLabel: account.productLabel,
              accountType: account.accountType,
              required: true,
              openedOn: null,
              closedOn: null,
            },
          }),
        );
        if (outcome.outcome === "error") throw new Error(describeError(outcome.error));
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.moneyAll() });
    },
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
      <div>
        <h3 className="text-sm font-medium">Set up the accounts Money follows</h3>
        <p className="text-sm text-muted-foreground">
          {missing.map((account) => account.productLabel).join(", ")} — the accounts that explain
          day-to-day cash flow and debt. Each binds to its bank identity on its first import.
        </p>
      </div>
      {setup.error === null ? null : (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Setup didn't finish</AlertTitle>
          <AlertDescription>{String(setup.error.message)}</AlertDescription>
        </Alert>
      )}
      <div>
        <Button size="sm" disabled={setup.isPending} onClick={() => setup.mutate()}>
          {setup.isPending ? <Spinner /> : null}
          Create {missing.length === 4 ? "the four accounts" : `${missing.length} missing`}
        </Button>
      </div>
    </div>
  );
}
