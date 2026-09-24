import type { MeasureImpact } from "@repo/contracts/finance";
import { formatCurrency } from "@repo/finance";
import { Record } from "effect";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { monthLabel } from "@/lib/period";

// The same totals the overview shows for the month, so a preview matches the screens
// once the change is saved.
const measures = {
  inflow: "Came in",
  outflow: "Went out",
  spending: "Spending",
  income: "Income",
  loanPrincipal: "Loan principal",
  unresolvedOut: "Out, not yet understood",
  unresolvedIn: "In, not yet understood",
  internal: "Moved between your accounts",
} as const;

export function ImpactTables({ impacts }: { impacts: readonly (typeof MeasureImpact.Type)[] }) {
  if (impacts.length === 0)
    return <p className="type-small text-slate">This change does not move any totals.</p>;
  return (
    <>
      {impacts.map((impact) => (
        <ImpactTable key={`${impact.currency}:${impact.start}`} impact={impact} />
      ))}
    </>
  );
}

function ImpactTable({ impact }: { impact: typeof MeasureImpact.Type }) {
  return (
    <section
      className="space-y-3 rounded-lg border border-rule bg-sheet p-4"
      aria-label={`Effect on ${monthLabel(impact.start.slice(0, 7))}`}
    >
      <h3 className="font-semibold">Effect on {monthLabel(impact.start.slice(0, 7))}</h3>
      <p className="type-small text-slate">
        By spending date · {impact.currency} · Calculated {impact.calculatedAt}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Measure</TableHead>
            <TableHead>Before</TableHead>
            <TableHead>After</TableHead>
            <TableHead>Change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Record.toEntries(measures).map(([key, label]) => {
            const before = impact.before[key];
            const after = impact.after[key];
            return (
              <TableRow key={key}>
                <TableCell>{label}</TableCell>
                <TableCell>{formatCurrency(before)}</TableCell>
                <TableCell>{formatCurrency(after)}</TableCell>
                <TableCell>
                  {formatCurrency({ ...after, minor: after.minor - before.minor })}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="type-small text-slate">
        Of spending after the change, {formatCurrency(impact.after.modelShare)} rests on the model's
        judgement. Bank records stay unchanged.
      </p>
    </section>
  );
}
