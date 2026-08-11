import { CalendarMonth, type CalendarDate, type MonthlyMoneyAnalysis } from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ironcage/ui/components/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@ironcage/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { BigDecimal, Schema } from "effect";
import { useState } from "react";

import {
  CallFailure,
  CoverageNotice,
  Metric,
  Panel,
  PanelSkeleton,
} from "@/features/money/components/money-panels";
import { aud, fullDayLabel, monthLabel, percent } from "@/features/money/format";
import { accountsQuery, analysisQuery, balancesQuery } from "@/features/money/queries";

const decodeMonth = Schema.decodeUnknownSync(CalendarMonth);

/** The month a fresh visit lands on: the one before now, the last that can be complete. */
const previousMonth = () => {
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  return decodeMonth(month.toISOString().slice(0, 7));
};

const shiftMonth = (month: CalendarMonth, by: number) => {
  const shifted = new Date(`${month}-01T00:00:00Z`);

  shifted.setUTCMonth(shifted.getUTCMonth() + by);

  return decodeMonth(shifted.toISOString().slice(0, 7));
};

export function MonthlySpending() {
  const [month, setMonth] = useState(previousMonth);
  const analysis = useQuery(analysisQuery(month, month));
  const accounts = useQuery(accountsQuery);
  const balances = useQuery(balancesQuery);
  const accountLabels = new Map(
    (accounts.data ?? []).map((account) => [account.id as string, account.label]),
  );
  const analysed = analysis.data?.months[0];

  return (
    <div className="flex flex-col gap-7">
      <Panel
        title="Complete-month spending"
        action={
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, -1))}>
              Earlier
            </Button>
            <span className="min-w-36 text-center font-display text-sm">{monthLabel(month)}</span>
            <Button variant="ghost" size="sm" onClick={() => setMonth(shiftMonth(month, 1))}>
              Later
            </Button>
          </div>
        }
      >
        {analysis.isPending ? (
          <PanelSkeleton rows={4} />
        ) : analysis.isError ? (
          <CallFailure error={analysis.error} />
        ) : analysed === undefined ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No analysis for {monthLabel(month)}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <MonthDetail
            month={analysed}
            accountLabels={accountLabels}
            dataThrough={analysis.data.dataThrough}
          />
        )}
      </Panel>

      <Panel title="Balances">
        {balances.isPending ? (
          <PanelSkeleton rows={4} />
        ) : balances.isError ? (
          <CallFailure error={balances.error} />
        ) : balances.data.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No balance has been imported</EmptyTitle>
              <EmptyDescription>
                A confirmed structured bundle records its account's ledger balance.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {balances.data
              .filter((balance) => balance.kind === "ledger")
              .map((balance) => (
                <Metric
                  key={`${balance.accountId}-${balance.kind}`}
                  label={balance.label}
                  value={aud(balance.amount)}
                  note={`as of ${fullDayLabel(balance.asOfDate)}`}
                  tone={BigDecimal.isNegative(balance.amount) ? "halted" : "default"}
                />
              ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function MonthDetail({
  month,
  accountLabels,
  dataThrough,
}: {
  readonly month: MonthlyMoneyAnalysis;
  readonly accountLabels: ReadonlyMap<string, string>;
  readonly dataThrough: CalendarDate | null;
}) {
  const through =
    dataThrough === null ? "no covered day yet" : `data through ${fullDayLabel(dataThrough)}`;

  return (
    <div className="flex flex-col gap-4">
      <CoverageNotice coverage={month.coverage} accountLabels={accountLabels} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Income"
          value={month.income === null ? "—" : aud(month.income)}
          note={month.income === null ? "unavailable" : through}
          tone={month.income === null ? "muted" : "default"}
        />
        <Metric
          label="Net spend"
          value={month.netSpend === null ? "—" : aud(month.netSpend)}
          note={month.netSpend === null ? "unavailable" : through}
          tone={month.netSpend === null ? "muted" : "default"}
        />
        <Metric
          label="Savings rate"
          value={month.savingsRate === null ? "—" : percent(month.savingsRate)}
          note={month.savingsRate === null ? "needs income" : through}
          tone={month.savingsRate === null ? "muted" : "live"}
        />
      </div>

      {month.categories.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Net spend</TableHead>
                <TableHead className="text-right">Trailing 3-month</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {month.categories.map((category) => (
                <TableRow key={category.categoryId} className="hover:bg-row-hover">
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {aud(category.netSpend)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground tabular-nums">
                    {category.trailingThreeMonthAverage === null
                      ? "—"
                      : aud(category.trailingThreeMonthAverage)}
                  </TableCell>
                  <TableCell className="text-right">
                    <CategoryChange
                      netSpend={category.netSpend}
                      average={category.trailingThreeMonthAverage}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-ink-faint tabular-nums">
                    {category.transactionIds.length}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * The change against the trailing average, shown only when there is a trailing
 * average to compare against. Three earlier complete months are what earn the
 * comparison; without them the cell stays empty rather than comparing against a
 * shorter window the operator did not ask for.
 */
function CategoryChange({
  netSpend,
  average,
}: {
  readonly netSpend: MonthlyMoneyAnalysis["categories"][number]["netSpend"];
  readonly average: MonthlyMoneyAnalysis["categories"][number]["trailingThreeMonthAverage"];
}) {
  if (average === null || BigDecimal.isZero(average))
    return <span className="text-ink-faint">—</span>;

  const change = BigDecimal.divideUnsafe(BigDecimal.subtract(netSpend, average), average);
  const rising = BigDecimal.isPositive(change);

  return (
    <Badge variant="ghost" className={rising ? "text-warning" : "text-live"}>
      {rising ? "+" : ""}
      {percent(change)}
    </Badge>
  );
}
