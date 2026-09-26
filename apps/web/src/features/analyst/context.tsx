import type { AskContext, RecordLink } from "@repo/contracts/analyst";
import type { CategoryScope, CounterpartyScope, MonthsSelection } from "@repo/contracts/finance";
import {
  dateLabel,
  measures,
  monthLabel,
  monthsPeriod,
  periodLabel,
  unspecifiedLabel,
} from "@repo/finance";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { referenceDataQuery } from "@/features/events/queries";
import { postingQueryOptions } from "@/features/ledger/queries";

import { type Names, namesOf } from "./names";
import { briefingOverview, recordLink } from "./record-link";

// The screen that shows what the analyst reads first: the one a question was asked from,
// or for a stream, the records it opens, as selecting the stream does.
function contextRecords(context: AskContext): RecordLink {
  switch (context.kind) {
    case "category":
      return { ...context, kind: "spending" };
    case "counterparty":
      return { kind: "counterparty", counterpartyId: context.counterpartyId };
    case "transaction":
      return { kind: "transaction", postingId: context.postingId };
    case "stream": {
      const { measure, ...scope } = context.scope;
      return measure === "spending"
        ? { kind: "spending", period: context.period, comparison: context.comparison, ...scope }
        : { kind: "countedLedger", scope: context.scope, period: context.period, filter: {} };
    }
    case "briefing":
      return briefingOverview(context.month);
  }
}

const monthsLabel = ({ from, to }: MonthsSelection) => periodLabel(monthsPeriod(from, to));

// A scope named as Spending names it, but money not yet categorised names its measure,
// because income and spending not yet categorised share the flow's name. A record merged
// or deleted since the question keeps a plain name.
function categoryLabel(category: CategoryScope, whole: string, names: Names) {
  switch (category.kind) {
    case "all":
      return whole;
    case "category":
      return names.category(category.id) ?? "A category";
    case "unspecified":
      return unspecifiedLabel(names.category(category.id) ?? "A category");
    case "uncategorised":
      return `${whole} not yet categorised`;
  }
}
function scopeLabel(
  category: CategoryScope,
  counterparty: CounterpartyScope,
  whole: string,
  names: Names,
) {
  const within = categoryLabel(category, whole, names);
  switch (counterparty.kind) {
    case "all":
      return within;
    case "unidentified":
      return `${within} at unidentified counterparties`;
    case "counterparty":
      return `${within} at ${names.counterparty(counterparty.id) ?? "a counterparty"}`;
  }
}

function contextLabel(context: Exclude<AskContext, { kind: "transaction" }>, names: Names) {
  switch (context.kind) {
    case "category": {
      const narrowing = [
        context.tagId && `tagged ${names.tag(context.tagId) ?? "a tag"}`,
        context.personalEventId &&
          `for ${names.personalEvent(context.personalEventId) ?? "a personal event"}`,
      ];
      return [
        scopeLabel(context.category, context.counterparty, "Spending", names),
        ...narrowing.filter(Boolean),
        `in ${monthsLabel(context.period)}`,
      ].join(" ");
    }
    case "counterparty":
      return names.counterparty(context.counterpartyId) ?? "A counterparty";
    case "stream": {
      const { measure, category, counterparty } = context.scope;
      const scope = scopeLabel(category, counterparty, measures[measure].label, names);
      return `${scope} in ${monthsLabel(context.period)}`;
    }
    case "briefing":
      return `The briefing for ${monthLabel(context.month)}`;
  }
}

// What a question is about, as a chip that opens what the analyst reads first. With
// `onRemove`, the question can be asked without it.
export function ContextChip({
  context,
  onRemove,
}: {
  context: AskContext;
  onRemove?: (() => void) | undefined;
}) {
  return context.kind === "transaction" ? (
    <TransactionChip context={context} onRemove={onRemove} />
  ) : (
    <NamedChip context={context} onRemove={onRemove} />
  );
}

function NamedChip({
  context,
  onRemove,
}: {
  context: Exclude<AskContext, { kind: "transaction" }>;
  onRemove: (() => void) | undefined;
}) {
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  return (
    <Chip
      label={contextLabel(context, namesOf(references))}
      records={contextRecords(context)}
      onRemove={onRemove}
    />
  );
}

// Named by the bank's description and the day it posted. A transaction removed since
// the question keeps a plain name.
function TransactionChip({
  context,
  onRemove,
}: {
  context: Extract<AskContext, { kind: "transaction" }>;
  onRemove: (() => void) | undefined;
}) {
  const posting = useQuery(postingQueryOptions({ postingId: context.postingId })).data?.posting;
  return (
    <Chip
      label={posting ? `${posting.description}, ${dateLabel(posting.postedOn)}` : "A transaction"}
      records={contextRecords(context)}
      onRemove={onRemove}
    />
  );
}

function Chip({
  label,
  records,
  onRemove,
}: {
  label: string;
  records: RecordLink;
  onRemove: (() => void) | undefined;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "h-auto max-w-full gap-0.5 overflow-visible bg-sheet py-0 type-small!",
        onRemove && "pr-0.5",
      )}
    >
      <Link {...recordLink(records)} className="truncate py-0.5 hover:underline">
        {label}
      </Link>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Ask without ${label}`}
          onClick={onRemove}
        >
          <X aria-hidden />
        </Button>
      )}
    </Badge>
  );
}
