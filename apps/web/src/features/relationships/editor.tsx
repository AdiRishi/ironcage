import {
  type FinancialEvent,
  type MovementKind,
  type RelationshipChange,
  type RelationshipCandidate,
  type PostingCursor,
  type ListRelationshipCandidates,
} from "@repo/contracts/finance";
import { formatDecimal, formatMoney, parseMoney } from "@repo/finance";
import { useForm } from "@tanstack/react-form";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Effect } from "effect";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ReferenceChoice } from "../events/choice";
import { listRelationshipCandidates } from "./functions";

type RelationshipFormValues = {
  external: string;
  movementKind: typeof MovementKind.Type;
  decimal: string;
};

export function RelationshipEditor({
  event,
  mode,
  onPreview,
  onChange,
}: {
  event: FinancialEvent;
  mode: "movement" | "cost" | "purchase";
  onPreview: (change: RelationshipChange) => void;
  onChange: () => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<typeof RelationshipCandidate.Type | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaultValues: RelationshipFormValues = {
    external: "",
    movementKind:
      event.kind === "cardSettlement" || event.kind === "loanPayment" || event.kind === "borrowing"
        ? event.kind
        : "transfer",
    decimal: formatDecimal(event.magnitude),
  };
  const candidates = useInfiniteQuery({
    queryKey: ["relationshipCandidates", event.id, mode, search],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof PostingCursor.Type | null }) => {
      const data: typeof ListRelationshipCandidates.Type = {
        eventId: event.id,
        kind: mode,
        search,
      };
      return listRelationshipCandidates({
        data: pageParam ? { ...data, cursor: pageParam } : data,
      });
    },
    getNextPageParam: (page) => page.nextCursor,
  });
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setError(null);
      if (mode === "movement") {
        if (!selected && !value.external.trim()) {
          setError("Choose a counterpart or name the external owned account.");
          return;
        }
        onPreview({
          kind: "linkMovement",
          eventId: event.id,
          movementKind: value.movementKind,
          counterpart: selected
            ? { kind: "event", eventId: selected.eventId }
            : { kind: "external", label: value.external },
        });
      } else if (!selected) setError("Choose the related transaction.");
      else if (mode === "purchase")
        onPreview({
          kind: "associateFee",
          feeEventId: event.id,
          purchaseEventId: selected.eventId,
          status: "confirmed",
        });
      else {
        const result = await Effect.runPromise(
          parseMoney(value.decimal, event.magnitude.currency).pipe(Effect.result),
        );
        if (result._tag === "Failure") setError(result.failure.message);
        else
          onPreview({
            kind: "linkCredit",
            creditAllocationId: event.allocations[0].id,
            costAllocationId: selected.allocationId,
            amount: result.success,
          });
      }
    },
  });
  return (
    <form
      className="space-y-4 rounded-md border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit().catch(reportError);
      }}
      onChange={onChange}
    >
      <h3 className="font-medium">
        {mode === "movement"
          ? "Link movement"
          : mode === "cost"
            ? "Apply credit to a cost"
            : "Associate fee with a purchase"}
      </h3>
      {mode === "movement" && (
        <>
          <form.Field name="movementKind">
            {(field) => (
              <ReferenceChoice
                label="Movement role"
                value={field.state.value}
                options={[
                  { id: "transfer", name: "Transfer" },
                  { id: "cardSettlement", name: "Card settlement" },
                  { id: "loanPayment", name: "Loan payment" },
                  { id: "borrowing", name: "Borrowing" },
                ]}
                onChange={(value) => {
                  if (value) field.handleChange(value);
                  onChange();
                }}
              />
            )}
          </form.Field>
          <form.Field name="external">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`${id}-external`}>
                  External owned account, when the counterpart is missing
                </Label>
                <Input
                  id={`${id}-external`}
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    setSelected(null);
                  }}
                />
              </div>
            )}
          </form.Field>
        </>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${id}-search`}>Find counterpart by description</Label>
        <Input id={`${id}-search`} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {selected && (
        <p className="text-sm">
          Selected {selected.posting.description} · {formatMoney(selected.remaining)} remaining
        </p>
      )}
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {candidates.data?.pages
          .flatMap((page) => page.rows)
          .map((candidate) => (
            <Button
              className="h-auto w-full justify-start text-left whitespace-normal"
              type="button"
              variant={selected?.allocationId === candidate.allocationId ? "secondary" : "outline"}
              key={candidate.allocationId}
              onClick={() => {
                setSelected(candidate);
                onChange();
              }}
            >
              <span>
                {candidate.posting.postedOn} · {candidate.posting.accountLabel} ·{" "}
                {candidate.posting.description}
                <br />
                {formatMoney(candidate.remaining)}
                {mode === "cost" ? " uncredited" : ""}
              </span>
            </Button>
          ))}
      </div>
      {candidates.isPending && <p>Loading candidates…</p>}
      {candidates.error && <p role="alert">{candidates.error.message}</p>}
      {candidates.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={candidates.isFetchingNextPage}
          onClick={() => {
            candidates.fetchNextPage().catch(reportError);
          }}
        >
          More candidates
        </Button>
      )}
      {mode === "cost" && (
        <form.Field name="decimal">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={`${id}-amount`}>Credit amount ({event.magnitude.currency})</Label>
              <Input
                id={`${id}-amount`}
                inputMode="decimal"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
      )}
      {error && <p role="alert">{error}</p>}
      <Button type="submit">Preview relationship</Button>
    </form>
  );
}
