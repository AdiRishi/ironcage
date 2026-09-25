import type { MeasureImpact } from "@repo/contracts/finance";
import { formatCurrency, periodLabel } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Array as Arr, Record } from "effect";
import { ChevronRight } from "lucide-react";
import { useId } from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { settingsQueryOptions } from "@/features/settings/queries";
import { instantLabel } from "@/lib/time";

type Impact = typeof MeasureImpact.Type;

// The same totals the overview shows for the month, so a preview matches the screens
// once the change is saved.
const totals = {
  inflow: "Came in",
  outflow: "Went out",
  spending: "Spending",
  income: "Income",
  loanPrincipal: "Loan principal",
  unresolvedOut: "Out, not yet understood",
  unresolvedIn: "In, not yet understood",
  internal: "Moved between your accounts",
} as const;
const everyMeasure = { ...totals, modelShare: "Spending on the model's judgement" } as const;

const movedTotals = (impact: Impact) =>
  Record.toEntries(totals).filter(([key]) => impact.before[key].minor !== impact.after[key].minor);

// Whether a change moves any of the month's totals. A new default category can change
// what many transactions mean and leave every total as it was.
export const movesTotals = (impact: Impact) => movedTotals(impact).length > 0;

// What a change does to each month's totals: one table of the months it moves with only
// the totals that move, and every total of every month under a disclosure, so a change
// across a year stays one short table that fits a phone.
export function ImpactSummary({ impacts }: { impacts: readonly Impact[] }) {
  const moved = impacts.filter(movesTotals);
  return Arr.isReadonlyArrayNonEmpty(moved) ? (
    <MovedTotals impacts={impacts} moved={moved} />
  ) : (
    <p className="type-small text-slate">This change does not move any totals.</p>
  );
}

function MovedTotals({
  impacts,
  moved,
}: {
  impacts: readonly Impact[];
  moved: Arr.NonEmptyReadonlyArray<Impact>;
}) {
  const id = useId();
  const first = Arr.headNonEmpty(moved);
  const last = Arr.lastNonEmpty(moved);
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const currencies = [...new Set(impacts.map((impact) => impact.currency))];
  const monthLabel = (impact: Impact) =>
    currencies.length > 1 ? `${periodLabel(impact)}, ${impact.currency}` : periodLabel(impact);
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3">
      <div>
        <h3 id={id} className="font-[600]">
          Effect on {periodLabel({ start: first.start, endExclusive: last.endExclusive })}
        </h3>
        <p className="type-small text-slate">
          By spending date · {currencies.join(", ")} · Calculated{" "}
          <time dateTime={first.calculatedAt}>
            {instantLabel(first.calculatedAt, settings.timezone)}
          </time>
        </p>
      </div>
      <ImpactTable
        label="Totals this change moves"
        impacts={moved}
        monthLabel={monthLabel}
        rows={movedTotals}
      />
      <Collapsible className="space-y-3">
        <CollapsibleTrigger className="group flex items-center gap-2 rounded-sm text-left type-small text-slate hover:text-intaglio">
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-90"
          />
          Every total, month by month
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ImpactTable
            label="Every total, month by month"
            impacts={impacts}
            monthLabel={monthLabel}
            rows={() => Record.toEntries(everyMeasure)}
          />
        </CollapsibleContent>
      </Collapsible>
      <p className="type-small text-slate">Bank records stay unchanged.</p>
    </section>
  );
}

// A row group per month, headed by the month, with a total, before, and after per row. The
// total's name wraps, so three columns fit a dialog on a phone.
function ImpactTable({
  label,
  impacts,
  monthLabel,
  rows,
}: {
  label: string;
  impacts: readonly Impact[];
  monthLabel: (impact: Impact) => string;
  rows: (impact: Impact) => readonly [keyof typeof everyMeasure, string][];
}) {
  return (
    <Table aria-label={label}>
      <TableHeader>
        <TableRow>
          <TableHead>Total</TableHead>
          <TableHead className="text-right">Before</TableHead>
          <TableHead className="text-right">After</TableHead>
        </TableRow>
      </TableHeader>
      {impacts.map((impact) => (
        <TableBody key={`${impact.currency}:${impact.start}`}>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="rowgroup" colSpan={3} className="font-[600]">
              {monthLabel(impact)}
            </TableHead>
          </TableRow>
          {rows(impact).map(([key, name]) => (
            <TableRow key={key}>
              <TableHead scope="row" className="h-auto font-normal whitespace-normal">
                {name}
              </TableHead>
              <TableCell className="text-right tabular">
                {formatCurrency(impact.before[key])}
              </TableCell>
              <TableCell className="text-right tabular">
                {formatCurrency(impact.after[key])}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      ))}
    </Table>
  );
}
