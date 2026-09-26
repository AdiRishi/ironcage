import type {
  ConversationId,
  Proposal,
  ProposalIntent,
  ProposalPreview,
  RecordLink,
} from "@repo/contracts/analyst";
import type {
  CalendarDate,
  CategoryId,
  CounterpartyRole,
  EventChange,
  FinancialEvent,
} from "@repo/contracts/finance";
import { calendarDateIn, dateLabel, financialRoleLabels } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { DateTime } from "effect";
import { useEffect, useId, useRef } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChangePreview } from "@/features/counterparties/change-preview";
import { ImpactSummary } from "@/features/events/impact";
import { referenceDataQuery } from "@/features/events/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { focusLost } from "@/lib/use-focus-request";

import { AnswerText, type Citations } from "./answer-text";
import { type Names, namesOf } from "./names";
import { recordLink } from "./record-link";
import { useProposal } from "./use-proposal";

// One value a change sets, as it was when previewed and as the change leaves it.
type Row = { name: string; before: string; after: string };

const none = "None";
const listed = new Intl.ListFormat("en-AU", { type: "conjunction" });
const changed = (rows: ReadonlyArray<Row>) => rows.filter((row) => row.before !== row.after);

function transactionRows(before: FinancialEvent, change: EventChange, names: Names) {
  const [was] = before.allocations;
  const [now] = change.allocations;
  const category = (id: typeof CategoryId.Type | null) =>
    id === null ? none : (names.category(id) ?? "A removed category");
  const labels = <Id extends string>(
    ids: ReadonlyArray<Id>,
    name: (id: Id) => string | undefined,
    removed: string,
  ) => (ids.length === 0 ? none : listed.format(ids.map((id) => name(id) ?? removed)));
  const date = (on: CalendarDate | null) => (on === null ? none : dateLabel(on));
  const yes = (value: boolean) => (value ? "Yes" : "No");
  return changed([
    {
      name: "Financial role",
      before: financialRoleLabels[before.kind],
      after: financialRoleLabels[change.kind],
    },
    { name: "Category", before: category(was.categoryId), after: category(now.categoryId) },
    { name: "Non-personal portion", before: yes(was.nonPersonal), after: yes(now.nonPersonal) },
    {
      name: "Tags",
      before: labels(was.tagIds, names.tag, "a removed tag"),
      after: labels(now.tagIds, names.tag, "a removed tag"),
    },
    {
      name: "Personal events",
      before: labels(was.personalEventIds, names.personalEvent, "a removed personal event"),
      after: labels(now.personalEventIds, names.personalEvent, "a removed personal event"),
    },
    { name: "Purchase date", before: date(before.purchaseOn), after: date(change.purchaseOn) },
  ]);
}

// A counterparty's defaults, or those of payments with one reference. A reference without
// defaults of its own follows the counterparty's.
function defaultRows(
  { before, change }: typeof ProposalPreview.cases.counterpartyChange.Type,
  names: Names,
) {
  const reference = change.kind === "saveReference";
  const after = reference ? change : change.fields;
  const unset = reference && before.defaultRole === null ? "As the defaults say" : none;
  const role = (value: typeof CounterpartyRole.Type | null, empty: string) =>
    value === null ? empty : financialRoleLabels[value];
  const category = (id: typeof CategoryId.Type | null, empty: string) =>
    id === null ? empty : (names.category(id) ?? "A removed category");
  return changed([
    {
      name: reference ? "Role" : "Default role",
      before: role(before.defaultRole, unset),
      after: role(after.defaultRole, none),
    },
    {
      name: reference ? "Category" : "Default category",
      before: category(before.defaultCategoryId, unset),
      after: category(after.defaultCategoryId, none),
    },
  ]);
}

function Changes({ preview }: { preview: ProposalPreview }) {
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  const names = namesOf(references);
  // A reference default names the payments it is for, by their reference's key.
  const payments =
    preview.kind === "counterpartyChange" && preview.change.kind === "saveReference"
      ? `payments marked ${preview.change.referenceKey}`
      : null;
  const rows =
    preview.kind === "correction"
      ? transactionRows(preview.before, preview.change, names)
      : defaultRows(preview, names);
  const head = "type-small font-normal text-slate";
  return (
    <div className="space-y-1">
      {payments && <p className="type-small text-slate">For {payments}</p>}
      <Table aria-label={payments ? `What changes for ${payments}` : "What changes"}>
        <TableHeader>
          <TableRow className="border-rule hover:bg-transparent">
            <TableHead scope="col" className={head}>
              What changes
            </TableHead>
            <TableHead scope="col" className={head}>
              Before
            </TableHead>
            <TableHead scope="col" className={head}>
              After
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name} className="border-rule hover:bg-transparent">
              <TableHead scope="row" className="h-auto font-normal whitespace-normal">
                {row.name}
              </TableHead>
              <TableCell className="whitespace-normal">{row.before}</TableCell>
              <TableCell className="whitespace-normal">{row.after}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Impact({ preview }: { preview: ProposalPreview }) {
  switch (preview.kind) {
    case "correction":
      return <ImpactSummary impacts={preview.impacts} heading="h5" />;
    case "counterpartyChange":
      return (
        <ChangePreview eventCount={preview.eventCount} impacts={preview.impacts} heading="h5" />
      );
  }
}

// The record a proposal changes, whose history can undo it once accepted.
function subjectOf(intent: ProposalIntent) {
  return intent.kind === "transaction"
    ? {
        name: "transaction",
        records: { kind: "transaction", postingId: intent.postingId } satisfies RecordLink,
      }
    : {
        name: "counterparty",
        records: {
          kind: "counterparty",
          counterpartyId: intent.counterpartyId,
        } satisfies RecordLink,
      };
}

// A change the analyst proposed, drawn from what the analyst stored when it previewed the
// change: the title code wrote, the analyst's reason, the values it changes, and its
// effect on each month. Accept applies it as previewed. When the records changed since,
// Preview again reads it against them, and Ignore sets aside one that no longer applies.
// A choice keeps focus on its button while it runs, so one that fails leaves you there.
// One that changes the proposal takes its buttons away, and focus moves to what became
// of it, or to Accept once Preview again leaves it pending.
export function ProposalCard({
  proposal,
  conversationId,
  cited,
}: {
  proposal: Proposal;
  conversationId: ConversationId;
  cited: Citations;
}) {
  const id = useId();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const actions = useProposal(conversationId, proposal);
  const outcome = useRef<HTMLParagraphElement>(null);
  const acceptButton = useRef<HTMLButtonElement>(null);
  const seen = useRef(proposal.status);
  useEffect(() => {
    if (seen.current === proposal.status) return;
    seen.current = proposal.status;
    if (focusLost()) (proposal.status === "pending" ? acceptButton : outcome).current?.focus();
  }, [proposal.status]);

  const subject = subjectOf(proposal.intent);
  const busy = actions.accepting || actions.ignoring || actions.refreshing;
  const resolvedOn =
    proposal.resolvedAt &&
    dateLabel(calendarDateIn(DateTime.makeUnsafe(proposal.resolvedAt), settings.timezone));
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="max-w-2xl min-w-0 space-y-4 rounded-lg border border-rule bg-sheet p-4"
    >
      <div className="space-y-1">
        <p className="type-small text-slate">Proposed change</p>
        <h4 id={`${id}-title`} className="font-[600]">
          {proposal.title}
        </h4>
      </div>
      <div className="max-w-prose space-y-1">
        <p className="type-small font-[560]">The analyst's reason</p>
        <div className="space-y-2 text-slate">
          <AnswerText text={proposal.reason} cited={cited} />
        </div>
      </div>
      {proposal.status !== "stale" && (
        <>
          <Changes preview={proposal.preview} />
          <Impact preview={proposal.preview} />
        </>
      )}
      {/* Keys keep a button that was pressed from coming back as another. */}
      {proposal.status === "pending" ? (
        <div key="choices" className="flex flex-wrap gap-2">
          <Button
            ref={acceptButton}
            size="sm"
            disabled={busy}
            focusableWhenDisabled
            onClick={actions.accept}
          >
            {actions.accepting ? "Accepting…" : actions.uncertain ? "Retry" : "Accept"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || actions.uncertain}
            focusableWhenDisabled
            onClick={actions.ignore}
          >
            {actions.ignoring ? "Ignoring…" : "Ignore"}
          </Button>
        </div>
      ) : (
        <div key="outcome" className="space-y-3">
          <p ref={outcome} tabIndex={-1}>
            {proposal.status === "accepted" && (
              <>
                Accepted{resolvedOn && ` ${resolvedOn}`}.{" "}
                <Link {...recordLink(subject.records)} className="underline underline-offset-4">
                  Open the {subject.name}
                </Link>{" "}
                to see it or undo it.
              </>
            )}
            {proposal.status === "ignored" && "Ignored"}
            {proposal.status === "stale" &&
              `This ${subject.name} changed after the analyst proposed this.`}
          </p>
          {proposal.status === "stale" && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                focusableWhenDisabled
                onClick={actions.refresh}
              >
                {actions.refreshing ? "Previewing…" : "Preview again"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                focusableWhenDisabled
                onClick={actions.ignore}
              >
                {actions.ignoring ? "Ignoring…" : "Ignore"}
              </Button>
            </div>
          )}
        </div>
      )}
      {actions.error && (
        <Alert variant="destructive">
          <AlertDescription>{actions.error.message}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
