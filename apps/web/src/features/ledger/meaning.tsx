import {
  ApplyCorrection,
  CommandId,
  type Counterparty,
  type FinancialEvent,
  type PostingDetail,
  type PostingId,
  type ReferenceData,
} from "@repo/contracts/finance";
import { financialRoleLabels } from "@repo/finance";
import { useQuery, useQueryClient, useSuspenseQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Array as Arr, Effect, Schema } from "effect";
import { useDeferredValue, useId, useState } from "react";

import { CategorySelect } from "@/components/category-select";
import { ProvenanceMark } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { ChangePreview } from "@/features/counterparties/change-preview";
import { counterpartyQuery } from "@/features/counterparties/queries";
import { useCounterpartyChange } from "@/features/counterparties/use-counterparty-change";
import { EventEditor } from "@/features/events/editor";
import { applyCorrection } from "@/features/events/functions";
import { EventHistory } from "@/features/events/history";
import { eventForPostingQuery, referenceDataQuery } from "@/features/events/queries";
import { RelationshipsPanel } from "@/features/relationships/panel";
import { useCommand } from "@/lib/use-command";
import { useFocusRequest } from "@/lib/use-focus-request";

import { CounterpartyChange } from "./counterparty-change";

type Descriptor = (typeof PostingDetail.Type)["descriptor"];

type Source = "you" | "rule" | "model" | "bank" | "none";

function sourceOf(
  value: FinancialEvent["roleSource"] | FinancialEvent["allocations"][number]["categorySource"],
  counterparty: Counterparty | null,
): Source {
  switch (value) {
    case "user":
    case "link":
      return "you";
    case "rule":
      return "rule";
    case "bank":
      return "bank";
    case "counterparty":
      return counterparty?.source === "model" ? "model" : "you";
    case null:
      return "none";
  }
}

// The first layer of a transaction: who it was with, what role it played, and which
// category it belongs to, each with who decided it.
export function Meaning({
  postingId,
  descriptor,
}: {
  postingId: typeof PostingId.Type;
  descriptor: Descriptor;
}) {
  const event = useQuery(eventForPostingQuery(postingId));
  const references = useQuery(referenceDataQuery());
  if (event.isPending || references.isPending) return <p className="text-slate">Loading…</p>;
  if (event.error || references.error)
    return <p role="alert">{(event.error ?? references.error)?.message}</p>;
  if (!event.data)
    return <p className="text-slate">This transaction has not been interpreted yet.</p>;
  return <MeaningDetail event={event.data} descriptor={descriptor} references={references.data} />;
}

function MeaningDetail({
  event: current,
  descriptor,
  references,
}: {
  event: FinancialEvent;
  descriptor: Descriptor;
  references: typeof ReferenceData.Type;
}) {
  // A change can leave the transaction with a counterparty this page has not loaded. The
  // deferred event keeps the transaction on screen as it was until that counterparty
  // loads. Suspending instead would blank the page and drop keyboard focus.
  const event = useDeferredValue(current);
  const [detail] = useSuspenseQueries({
    queries: Arr.fromNullishOr(event.counterpartyId).map((id) => counterpartyQuery(id)),
  });
  const counterparty = detail?.data.counterparty ?? null;
  const [editing, setEditing] = useState(false);
  const [allocation] = event.allocations;
  const split = event.allocations.length > 1;
  const category = references.categories.find((row) => row.id === allocation.categoryId);
  const categorySource = sourceOf(allocation.categorySource, counterparty);
  const categorised = ["purchase", "financingCost", "refund", "reimbursement", "income"].includes(
    event.kind,
  );
  return (
    <section aria-labelledby="meaning-heading" className="space-y-5">
      <h2 id="meaning-heading" className="type-heading">
        What it means
      </h2>
      <dl className="grid grid-cols-[7.5rem_1fr] gap-x-4 gap-y-4">
        <dt className="text-slate">Counterparty</dt>
        <dd className="space-y-1">
          <span className="flex items-center gap-2">
            {counterparty ? (
              <Link
                to="/counterparties/$counterpartyId"
                params={{ counterpartyId: counterparty.id }}
                className="font-[560] hover:underline"
              >
                {counterparty.name}
              </Link>
            ) : (
              <span className="text-slate">Not identified yet</span>
            )}
            {counterparty && (
              <ProvenanceMark
                assignedBy={
                  event.counterpartySource === "user" || counterparty.source === "user"
                    ? "you"
                    : "model"
                }
                question={counterparty.status === "proposed"}
              />
            )}
            {event.active && (
              <CounterpartyChange event={event} descriptor={descriptor} references={references} />
            )}
          </span>
          {counterparty?.source === "model" && counterparty.reason && (
            <span className="block type-small text-slate">
              The model: {counterparty.reason}
              {counterparty.confidence !== null &&
                ` ${Math.round(counterparty.confidence * 100)}% sure.`}
            </span>
          )}
        </dd>

        <dt className="text-slate">Role</dt>
        <dd className="flex items-center gap-2">
          {financialRoleLabels[event.kind]}
          <ProvenanceMark
            assignedBy={sourceOf(event.roleSource, counterparty)}
            question={event.kind === "unresolved"}
          />
        </dd>

        {categorised && (
          <>
            <dt className="text-slate">Category</dt>
            <dd className="space-y-2">
              {split ? (
                <ul className="space-y-1">
                  {event.allocations.map((row) => (
                    <li key={row.id}>
                      {references.categories.find((item) => item.id === row.categoryId)?.name ??
                        "No category"}
                    </li>
                  ))}
                </ul>
              ) : (
                <CategoryChange
                  event={event}
                  references={references}
                  counterparty={counterparty}
                  current={category?.id ?? null}
                  source={categorySource}
                />
              )}
            </dd>
          </>
        )}
        {event.purchaseOn && (
          <>
            <dt className="text-slate">Purchased</dt>
            <dd>{event.purchaseOn}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Change role, split, or labels
        </Button>
      </div>
      {editing && (
        <EventEditor event={event} references={references} onClose={() => setEditing(false)} />
      )}
      <RelationshipsPanel event={event} />
      <EventHistory eventId={event.id} references={references} />
    </section>
  );
}

// Changing one transaction's category asks whether the counterparty's default should
// change instead, which applies it to every transaction from them after a preview.
function CategoryChange({
  event,
  references,
  counterparty,
  current,
  source,
}: {
  event: FinancialEvent;
  references: typeof ReferenceData.Type;
  counterparty: Counterparty | null;
  current: FinancialEvent["allocations"][number]["categoryId"];
  source: Source;
}) {
  const id = useId();
  const client = useQueryClient();
  // The choice below the select comes and goes, and the select is disabled while a change
  // saves, so focus returns to the select once the choice is settled and moves to the
  // apply button when a preview arrives.
  const [selectRef, requestSelect] = useFocusRequest<HTMLSelectElement>();
  const [applyRef, requestApply] = useFocusRequest<HTMLButtonElement>();
  const [pending, setPending] = useState<typeof current | undefined>(undefined);
  const settle = () => {
    requestSelect();
    setPending(undefined);
  };
  const correction = useCommand({
    mutationFn: async (data: typeof ApplyCorrection.Type) =>
      applyCorrection({
        data: await Effect.runPromise(Schema.encodeEffect(ApplyCorrection)(data)),
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  const everywhere = useCounterpartyChange(settle);
  const tree = event.kind === "income" ? "income" : "spending";
  const choose = (value: typeof current) => {
    everywhere.reset();
    if (value === current) return setPending(undefined);
    if (counterparty) return setPending(value);
    applyOnlyThis(value);
  };
  const applyOnlyThis = (value: typeof current) => {
    correction.submit({
      commandId: CommandId.make(crypto.randomUUID()),
      expectedVersions: [{ eventId: event.id, version: event.version }],
      change: {
        eventId: event.id,
        kind: event.kind,
        purchaseOn: event.purchaseOn,
        allocations: Arr.map(event.allocations, (row) => ({ ...row, categoryId: value })),
      },
    });
    settle();
  };
  const previewEverywhere = (value: typeof current) => {
    requestApply();
    if (counterparty)
      everywhere.preview({
        kind: "update",
        counterpartyId: counterparty.id,
        expectedVersion: counterparty.version,
        fields: {
          name: counterparty.name,
          kind: counterparty.kind,
          brand: counterparty.brand,
          defaultCategoryId: value,
          defaultRole: counterparty.defaultRole,
        },
      });
  };
  const busy = correction.mutation.isPending || everywhere.pending || everywhere.uncertain;
  const error = correction.mutation.error ?? everywhere.error;
  const previewed = everywhere.previewed;
  return (
    <div className="space-y-2">
      <span className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Category
        </label>
        <CategorySelect
          ref={selectRef}
          id={id}
          categories={references.categories}
          tree={tree}
          value={pending === undefined ? current : pending}
          onChange={choose}
          disabled={busy}
        />
        <ProvenanceMark assignedBy={source} />
      </span>
      {pending !== undefined && counterparty && !previewed && (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Where the change applies</legend>
          <span aria-hidden className="type-small text-slate">
            Apply to
          </span>
          <Button size="sm" onClick={() => previewEverywhere(pending)} disabled={busy}>
            {everywhere.previewing ? "Calculating…" : `Every ${counterparty.name} transaction`}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => applyOnlyThis(pending)}
            disabled={busy}
          >
            Only this one
          </Button>
          <Button size="sm" variant="ghost" onClick={settle} disabled={busy}>
            Cancel
          </Button>
        </fieldset>
      )}
      {counterparty && previewed && (
        <div className="space-y-3">
          <ChangePreview eventCount={previewed.eventCount} impacts={previewed.impacts} />
          <div className="flex flex-wrap gap-2">
            <Button
              ref={applyRef}
              size="sm"
              onClick={everywhere.confirm}
              disabled={everywhere.pending}
              focusableWhenDisabled
            >
              {everywhere.pending
                ? "Saving…"
                : everywhere.uncertain
                  ? "Retry"
                  : `Apply to all ${counterparty.name} transactions`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                everywhere.reset();
                settle();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="type-small text-attention">
          {error.message}
        </p>
      )}
    </div>
  );
}
