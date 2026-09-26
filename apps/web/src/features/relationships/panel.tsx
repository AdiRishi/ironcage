import {
  ApplyRelationship,
  CommandId,
  type EventId,
  type FinancialEvent,
  type InterpretationReviewEvent,
  RelationshipChange,
} from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { getEvent } from "../events/functions";
import { ImpactSummary } from "../events/impact";
import { RelationshipEditor } from "./editor";
import { applyRelationship, getEventRelationships, previewRelationship } from "./functions";

// An event as a link to its transaction.
export function EventLink({ event }: { event: InterpretationReviewEvent }) {
  return (
    <Link
      className="underline underline-offset-4"
      to="/ledger/$id"
      params={{ id: event.primaryPostingId }}
    >
      {event.description} · {formatCurrency(event.magnitude)}
    </Link>
  );
}
function RelatedEvent({ eventId }: { eventId: typeof EventId.Type }) {
  const query = useQuery({
    queryKey: ["event", { eventId }],
    queryFn: () => getEvent({ data: { eventId } }),
  });
  const event = query.data;
  const primary = event?.postings.find((posting) => posting.id === event.primaryPostingId);
  return event && primary ? (
    <EventLink event={{ ...event, description: primary.description }} />
  ) : (
    <span>{query.error?.message ?? "Loading related event…"}</span>
  );
}
export function RelationshipsPanel({ event }: { event: FinancialEvent }) {
  const query = useQuery({
    queryKey: ["relationships", event.id],
    queryFn: () => getEventRelationships({ data: { eventId: event.id } }),
  });
  const [mode, setMode] = useState<"movement" | "cost" | "purchase" | null>(null);
  const client = useQueryClient();
  const preview = useMutation({
    mutationFn: async (change: RelationshipChange) =>
      previewRelationship({
        data: { change: await Effect.runPromise(Schema.encodeEffect(RelationshipChange)(change)) },
      }),
  });
  const { mutation, submit, uncertain } = useCommand({
    mutationFn: async (data: typeof ApplyRelationship.Type) =>
      applyRelationship({
        data: await Effect.runPromise(Schema.encodeEffect(ApplyRelationship)(data)),
      }),
    onSuccess: async () => {
      preview.reset();
      setMode(null);
      await client.invalidateQueries();
    },
  });
  const relationships = query.data;
  return (
    <section className="space-y-4 border-t pt-4">
      <h3 className="font-medium">Related transactions</h3>
      {query.error && <p role="alert">{query.error.message}</p>}
      {relationships?.movement && (
        <div className="space-y-2">
          <p>
            Confirmed movement ·{" "}
            {event.postings.length === 1 ? "Counterpart posting missing" : "Both sides recorded"}
          </p>
          {[relationships.movement.from, relationships.movement.to].map((endpoint, index) => (
            <p key={index}>
              {index === 0 ? "From" : "To"}{" "}
              {endpoint.kind === "external"
                ? endpoint.label
                : (event.postings.find((posting) => posting.accountId === endpoint.accountId)
                    ?.accountLabel ?? "Owned account")}
            </p>
          ))}
          {event.postings.map((posting) => (
            <p key={posting.id}>
              <Link className="underline" to="/ledger/$id" params={{ id: posting.id }}>
                {posting.postedOn} · {posting.description} · {formatCurrency(posting.amount)}
              </Link>
            </p>
          ))}
          <Button
            variant="outline"
            onClick={() => preview.mutate({ kind: "unlinkMovement", eventId: event.id })}
          >
            Preview unlink movement
          </Button>
        </div>
      )}
      {relationships?.credits.map((link) => (
        <div className="space-y-2" key={link.id}>
          <p>
            {formatCurrency(link.amount)}{" "}
            {link.creditEventId === event.id ? "applied to" : "credited from"}{" "}
            <RelatedEvent
              eventId={link.creditEventId === event.id ? link.costEventId : link.creditEventId}
            />
          </p>
          <Button
            variant="outline"
            onClick={() => preview.mutate({ kind: "unlinkCredit", creditLinkId: link.id })}
          >
            Preview remove credit
          </Button>
        </div>
      ))}
      {relationships &&
        relationships.credits.length > 0 &&
        relationships.remaining.map((row, index) => (
          <p className="type-small text-slate" key={row.allocationId}>
            {formatCurrency(row.amount)}
            {relationships.remaining.length > 1 && ` of part ${index + 1}`} still counts after
            credits.
          </p>
        ))}
      {relationships?.fees.map((fee) => (
        <div className="space-y-2" key={fee.feeEventId}>
          <p>
            {fee.status === "confirmed" ? "Associated fee" : "Proposed fee association"} ·{" "}
            <RelatedEvent
              eventId={fee.feeEventId === event.id ? fee.purchaseEventId : fee.feeEventId}
            />
          </p>
          <Button
            variant="outline"
            onClick={() => preview.mutate({ kind: "removeFee", feeEventId: fee.feeEventId })}
          >
            Preview remove fee association
          </Button>
        </div>
      ))}
      <fieldset disabled={mutation.isPending || uncertain} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {!relationships?.movement &&
            event.postings.length === 1 &&
            event.allocations.length === 1 && (
              <Button
                variant="outline"
                onClick={() => {
                  setMode("movement");
                  preview.reset();
                }}
              >
                Link movement
              </Button>
            )}
          {(event.kind === "refund" || event.kind === "reimbursement") && (
            <Button
              variant="outline"
              onClick={() => {
                setMode("cost");
                preview.reset();
              }}
            >
              Apply credit
            </Button>
          )}
          {event.kind === "financingCost" && (
            <Button
              variant="outline"
              onClick={() => {
                setMode("purchase");
                preview.reset();
              }}
            >
              Associate fee
            </Button>
          )}
        </div>
        {mode && (
          <RelationshipEditor
            key={mode}
            event={event}
            mode={mode}
            onPreview={(change) => preview.mutate(change)}
            onChange={() => preview.reset()}
          />
        )}
      </fieldset>
      {preview.isPending && <p>Calculating impact…</p>}
      {preview.error && <p role="alert">{preview.error.message}</p>}
      {preview.data && (
        <div className="space-y-4">
          <ImpactSummary impacts={preview.data.impacts} />
          <Button
            disabled={mutation.isPending}
            onClick={() => {
              if (preview.data)
                submit({
                  commandId: CommandId.make(crypto.randomUUID()),
                  change: preview.data.change,
                  expectedVersions: preview.data.expectedVersions,
                });
            }}
          >
            {uncertain ? "Retry relationship" : "Confirm relationship"}
          </Button>
        </div>
      )}
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
    </section>
  );
}
