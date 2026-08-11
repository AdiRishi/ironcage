import { BankAccount, type BankAccountProfileId } from "@ironcage/domain";
import { Button } from "@ironcage/ui/components/button";
import { Input } from "@ironcage/ui/components/input";
import { Label } from "@ironcage/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { Spinner } from "@ironcage/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { keys } from "@/data/keys";
import { CallFailure, Panel } from "@/features/money/components/money-panels";
import { unwrap } from "@/features/money/queries";
import { newRequestId } from "@/lib/request-id";
import { registerBankAccount } from "@/server/money";

/**
 * The four product accounts, and the OFX identity each one's export carries.
 * `home-loan` prints `CREDITLINE` where the offsets print `SAVINGS`, and the
 * Mastercard has no bank or type at all because its export uses `CCACCTFROM`.
 */
const profiles = [
  { id: "spending-offset", label: "Spending offset", accountType: "SAVINGS" },
  { id: "savings-offset", label: "Savings offset", accountType: "SAVINGS" },
  { id: "mastercard", label: "Mastercard", accountType: null },
  { id: "home-loan", label: "Home loan", accountType: "CREDITLINE" },
] as const satisfies readonly {
  readonly id: BankAccountProfileId;
  readonly label: string;
  readonly accountType: string | null;
}[];

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Registering an account is what binds a bank-supplied identity to a product
 * profile. Every later import proves its OFX identity against this, so a file
 * for the wrong account is refused before a single row is matched.
 *
 * The bank identity is read off the account's own OFX export: `BANKID` and
 * `ACCTID` inside `BANKACCTFROM`, or `ACCTID` alone inside `CCACCTFROM`.
 */
export function RegisterAccount({ taken }: { readonly taken: readonly BankAccountProfileId[] }) {
  const queryClient = useQueryClient();
  const available = profiles.filter((profile) => !taken.includes(profile.id));
  const [profileId, setProfileId] = useState(available[0]?.id ?? profiles[0].id);
  const [label, setLabel] = useState("");
  const [bankId, setBankId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);

  const profile = profiles.find((candidate) => candidate.id === profileId) ?? profiles[0];
  const register = useMutation({
    mutationFn: async () =>
      unwrap(BankAccount)(
        await registerBankAccount({
          data: {
            account: {
              id: newRequestId(),
              profile: profileId,
              label: label.trim() === "" ? profile.label : label.trim(),
              maskedSuffix: accountId.slice(-4),
              identity:
                profile.accountType === null
                  ? { messageSet: "credit_card", accountId }
                  : {
                      messageSet: "bank",
                      bankId,
                      accountId,
                      accountType: profile.accountType,
                    },
              required: true,
              effectiveFrom,
            },
            requestId: newRequestId(),
          },
        }),
      ),
    onSuccess: () => {
      setLabel("");
      setBankId("");
      setAccountId("");
      return queryClient.invalidateQueries({ queryKey: keys.money() });
    },
  });

  if (available.length === 0) return null;

  return (
    <Panel title="Register a required account">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          Read the identity from the account's own OFX export. Money stores a keyed HMAC of it,
          never the number itself.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Product" htmlFor="profile">
            <Select
              value={profileId}
              onValueChange={(value) => {
                if (value !== null) setProfileId(value as BankAccountProfileId);
              }}
            >
              <SelectTrigger id="profile">
                {/* Base UI renders the raw value unless the label is derived here. */}
                <SelectValue>
                  {(value) =>
                    profiles.find((candidate) => candidate.id === value)?.label ??
                    "Choose a product"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {available.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Label" htmlFor="label">
            <Input
              id="label"
              value={label}
              placeholder={profile.label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>

          {profile.accountType !== null && (
            <Field label="BANKID" htmlFor="bankId">
              <Input
                id="bankId"
                value={bankId}
                className="font-mono"
                onChange={(event) => setBankId(event.target.value)}
              />
            </Field>
          )}

          <Field label="ACCTID" htmlFor="acctId">
            <Input
              id="acctId"
              value={accountId}
              className="font-mono"
              onChange={(event) => setAccountId(event.target.value)}
            />
          </Field>

          <Field label="Effective from" htmlFor="effectiveFrom">
            <Input
              id="effectiveFrom"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          </Field>
        </div>

        {register.isError && <CallFailure error={register.error} />}

        <div className="flex items-center gap-3">
          <Button
            disabled={
              register.isPending ||
              accountId.trim() === "" ||
              (profile.accountType !== null && bankId.trim() === "")
            }
            onClick={() => register.mutate()}
          >
            {register.isPending && <Spinner />}
            Register
          </Button>
          {register.data !== undefined && (
            <span className="text-sm text-live">
              {register.data.label} registered, ending {register.data.maskedSuffix}
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
