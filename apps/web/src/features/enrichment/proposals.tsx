import {
  CommandId,
  type CategoryProposals,
  type ResolveCategoryProposal,
} from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { resolveCategoryProposal } from "./functions";

// Subcategories the model would have used if they existed.
export function CategoryProposalsSection({
  proposals,
}: {
  proposals: typeof CategoryProposals.Type;
}) {
  if (proposals.length === 0) return null;
  return (
    <section aria-labelledby="proposals-heading" className="space-y-4 border-t border-rule pt-8">
      <div>
        <h2 id="proposals-heading" className="type-heading">
          Suggested subcategories
        </h2>
        <p className="mt-1 type-small text-slate">
          Accepting one creates it and moves the model's counterparties into it. Counterparties you
          set stay where they are.
        </p>
      </div>
      <ul className="divide-y divide-rule border-y border-rule">
        {proposals.map((proposal) => (
          <Proposal key={proposal.id} proposal={proposal} />
        ))}
      </ul>
    </section>
  );
}

function Proposal({ proposal }: { proposal: (typeof CategoryProposals.Type)[number] }) {
  const client = useQueryClient();
  const resolve = useCommand({
    mutationFn: (data: typeof ResolveCategoryProposal.Type) => resolveCategoryProposal({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const submit = (decision: "accept" | "dismiss") =>
    resolve.submit({
      commandId: CommandId.make(crypto.randomUUID()),
      proposalId: proposal.id,
      decision,
    });
  const shown = proposal.counterparties.slice(0, 4);
  const rest = proposal.counterparties.length - shown.length;
  return (
    <li className="grid gap-3 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
      <div className="min-w-0 space-y-1">
        <p>
          <span className="text-slate">{proposal.parentName} /</span>{" "}
          <span className="font-[600]">{proposal.name}</span>
        </p>
        <p className="type-small text-slate">{proposal.reason}</p>
        {shown.length > 0 && (
          <p className="type-small">
            Would move{" "}
            {shown.map((row, index) => (
              <span key={row.id}>
                {index > 0 && ", "}
                <Link
                  to="/counterparties/$counterpartyId"
                  params={{ counterpartyId: row.id }}
                  className="underline-offset-4 hover:underline"
                >
                  {row.name}
                </Link>
              </span>
            ))}
            {rest > 0 && ` and ${rest} more`}.
          </p>
        )}
        {resolve.mutation.error && (
          <p role="alert" className="type-small text-attention">
            {resolve.mutation.error.message}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={resolve.mutation.isPending} onClick={() => submit("accept")}>
          Add it
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={resolve.mutation.isPending}
          onClick={() => submit("dismiss")}
        >
          No thanks
        </Button>
      </div>
    </li>
  );
}
