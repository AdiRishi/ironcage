import type { PostingId } from "@repo/contracts/finance";
import { financialRoleLabels, formatMoney } from "@repo/finance";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { EventSuggestion } from "../classification/event-suggestion";
import { RelationshipsPanel } from "../relationships/panel";
import { EventEditor } from "./editor";
import { EventHistory } from "./history";
import { eventForPostingQuery, referenceDataQuery } from "./queries";

export function InterpretationPanel({ postingId }: { postingId: typeof PostingId.Type }) {
  const [editing, setEditing] = useState(false);
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
          <Button variant="outline" onClick={() => setEditing(true)} disabled={!references.data}>
            Edit interpretation
          </Button>
          {references.error && (
            <p role="alert">
              {references.error.message}
              <Button
                variant="link"
                onClick={() => {
                  references.refetch().catch(reportError);
                }}
              >
                Retry reference data
              </Button>
            </p>
          )}
          {editing && references.data && (
            <EventEditor
              event={event}
              references={references.data}
              onClose={() => setEditing(false)}
            />
          )}
          {event.purchaseOn && <p>Purchase date {event.purchaseOn}</p>}
          {event.allocations.map((allocation) => (
            <div key={allocation.id} className="flex flex-wrap justify-between gap-2 border-t pt-3">
              <div className="space-y-1">
                <p>
                  {references.data?.categories.find(
                    (category) => category.id === allocation.categoryId,
                  )?.name ?? "Uncategorized"}
                </p>
                {allocation.merchantId && (
                  <p className="text-sm">
                    {
                      references.data?.merchants.find(
                        (merchant) => merchant.id === allocation.merchantId,
                      )?.name
                    }
                  </p>
                )}
                {allocation.nonPersonal && (
                  <p className="text-sm text-muted-foreground">Non-personal</p>
                )}
                <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
                  {references.data?.tags
                    .filter((tag) => allocation.tagIds.includes(tag.id))
                    .map((tag) => (
                      <span key={tag.id}>{tag.name}</span>
                    ))}
                  {references.data?.personalEvents
                    .filter((personal) => allocation.personalEventIds.includes(personal.id))
                    .map((personal) => (
                      <span key={personal.id}>{personal.name}</span>
                    ))}
                </div>
              </div>
              <span>{formatMoney(allocation.amount)}</span>
            </div>
          ))}
          <RelationshipsPanel event={event} />
          <EventSuggestion eventId={event.id} />
          <EventHistory eventId={event.id} />
        </>
      ) : (
        <p className="text-muted-foreground">
          Use Interpret transactions on the transactions page to create this event.
        </p>
      )}
    </section>
  );
}
