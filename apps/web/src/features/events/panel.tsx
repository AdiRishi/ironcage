import type { PostingId } from "@repo/contracts/finance";
import { financialRoleLabels, formatMoney } from "@repo/finance";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";

import { eventForPostingQuery, referenceDataQuery } from "./queries";

export function InterpretationPanel({ postingId }: { postingId: typeof PostingId.Type }) {
  const query = useQuery(eventForPostingQuery(postingId));
  const references = useQuery(referenceDataQuery());
  if (query.isPending) return <output>Loading interpretation…</output>;
  if (query.error)
    return (
      <p role="alert">
        {query.error.message}{" "}
        <Button
          variant="link"
          onClick={() => {
            query.refetch().catch(reportError);
          }}
        >
          Retry
        </Button>
      </p>
    );
  const event = query.data;
  return (
    <section className="space-y-4 rounded-lg border p-5">
      <h2 className="text-xl font-semibold">Financial interpretation</h2>
      {event ? (
        <>
          <p>
            {financialRoleLabels[event.kind]} · {formatMoney(event.magnitude)}
          </p>
          {event.kind === "unresolved" && (
            <p className="text-muted-foreground">
              The source does not establish a financial role. This transaction needs interpretation
              review.
            </p>
          )}
          {event.purchaseOn && <p>Purchase date {event.purchaseOn}</p>}
          {event.allocations.map((allocation) => (
            <div key={allocation.id} className="flex flex-wrap justify-between gap-2 border-t pt-3">
              <span>
                {references.data?.categories.find(
                  (category) => category.id === allocation.categoryId,
                )?.name ?? "Uncategorized"}
              </span>
              <span>{formatMoney(allocation.amount)}</span>
            </div>
          ))}
        </>
      ) : (
        <p className="text-muted-foreground">
          Use Interpret transactions on the transactions page to create this event.
        </p>
      )}
    </section>
  );
}
