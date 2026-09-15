import type { MeasureImpact } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { Record } from "effect";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const measures = {
  grossCosts: "Gross costs",
  netPersonalCosts: "Net personal costs",
  income: "Income",
  cashChange: "Cash balance change",
  loanRepayments: "Loan repayments",
  financingCosts: "Loan interest and fees",
  netPrincipalReduction: "Net principal reduction",
} as const;
export function ImpactTable({ impact }: { impact: typeof MeasureImpact.Type }) {
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Financial impact">
      <h3 className="font-semibold">Effect on {impact.start.slice(0, 7)}</h3>
      <p className="text-sm text-muted-foreground">
        Posted basis · {impact.currency} · All {impact.accountIds.length} accounts · Calculated{" "}
        {impact.calculatedAt}
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
                <TableCell>{before ? formatMoney(before) : "Incomplete coverage"}</TableCell>
                <TableCell>{after ? formatMoney(after) : "Incomplete coverage"}</TableCell>
                <TableCell>
                  {before && after
                    ? formatMoney({ ...after, minor: after.minor - before.minor })
                    : "Unavailable"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {impact.after.unresolvedCount > 0 && (
        <p className="text-sm text-muted-foreground">
          {impact.after.unresolvedCount} unresolved events may change these totals.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Observed deposit movement: {formatMoney(impact.after.observedCashMovement)}. Bank records
        stay unchanged.
      </p>
    </section>
  );
}
