import { CommandId, type InterpretPostings } from "@repo/contracts/finance";
import { financialRoleLabels } from "@repo/finance";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { interpretPostings } from "./functions";
import { interpretationSummaryQuery } from "./queries";

export function InterpretTransactions() {
  const client = useQueryClient();
  const summary = useQuery(interpretationSummaryQuery());
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: (data: typeof InterpretPostings.Type) => interpretPostings({ data }),
    onSuccess: async () => {
      await client.invalidateQueries();
    },
  });
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Interpretation">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p>
          {summary.data
            ? `${summary.data.remaining} transactions awaiting interpretation`
            : "Loading interpretation…"}
        </p>
        <Button
          disabled={mutation.isPending || (summary.data?.remaining === 0 && !uncertain)}
          onClick={() => submit({ commandId: CommandId.make(crypto.randomUUID()), scope: "all" })}
        >
          {mutation.isPending
            ? "Interpreting…"
            : uncertain
              ? "Retry interpretation"
              : "Interpret transactions"}
        </Button>
      </div>
      {summary.error && (
        <p role="alert">
          {summary.error.message}{" "}
          <Button
            variant="link"
            onClick={() => {
              summary.refetch().catch(reportError);
            }}
          >
            Retry
          </Button>
        </p>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {summary.data?.counts.map(({ role, count }) => (
          <Link key={role} to="/transactions" search={{ role }} className="underline">
            {financialRoleLabels[role]}: {count}
          </Link>
        ))}
      </div>
    </section>
  );
}
