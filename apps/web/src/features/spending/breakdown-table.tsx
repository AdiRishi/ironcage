import type { SpendingBreakdown, SpendingRow } from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, metaHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { cn } from "cn";
import { useMemo } from "react";

import { Amount } from "@/components/amount";
import { Sparkline } from "@/components/sparkline";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { categoryColor } from "@/lib/category-colors";
import type { PeriodChoice } from "@/lib/period";

import { type Narrowing, spendingSearch } from "./search";

// `rowHeader` renders the column's cells as the row's header, which names the row.
const features = tableFeatures({
  columnMeta: metaHelper<{ className: string; rowHeader?: boolean }>(),
});
const helper = createColumnHelper<typeof features, SpendingRow>();
const numeric = "text-right tabular";
const rowId = (row: SpendingRow) => JSON.stringify(row.opens);

function Nothing() {
  return (
    <>
      <span aria-hidden>—</span>
      <span className="sr-only">None</span>
    </>
  );
}

const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}%`;

function Change({ figures, unrecorded }: { figures: SpendingRow["figures"]; unrecorded: boolean }) {
  if (unrecorded) return "No records";
  if (figures.change.minor === 0n) return "No change";
  if (figures.previous.minor === 0n) return "New";
  return (
    <>
      <Amount value={figures.change} signed cents={false} />
      {figures.percentChange !== null && ` (${percent(figures.percentChange)})`}
    </>
  );
}

function columnsFor({
  level,
  months,
  period,
  previousLabel,
  unrecorded,
  narrowing,
}: {
  level: SpendingBreakdown["level"];
  months: SpendingBreakdown["months"];
  period: PeriodChoice;
  previousLabel: string;
  unrecorded: boolean;
  narrowing: Narrowing;
}) {
  return helper.columns([
    helper.display({
      id: "name",
      header: level === "counterparties" ? "Counterparty" : "Category",
      meta: { className: "sticky left-0 z-10 bg-background pr-6", rowHeader: true },
      cell: ({ row: { original: row } }) => {
        const color = categoryColor(row.slug);
        return (
          <span className="flex items-center gap-3">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: color }}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-3">
                <Link
                  to="/spending"
                  search={spendingSearch(row.opens, narrowing)}
                  className="truncate rounded-sm hover:text-intaglio hover:underline"
                >
                  {row.label}
                </Link>
                {row.share !== null && (
                  <span className="type-small text-slate tabular">
                    {row.share}%<span className="sr-only"> of the spending</span>
                  </span>
                )}
              </span>
              <span aria-hidden className="mt-1 block h-1 rounded-full bg-rule/60">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${row.share ?? 0}%`, background: color }}
                />
              </span>
            </span>
          </span>
        );
      },
    }),
    helper.display({
      id: "amount",
      header: period.label,
      meta: { className: numeric },
      cell: ({ row }) => <Amount value={row.original.figures.current} cents={false} />,
    }),
    helper.display({
      id: "change",
      header: () => (
        <>
          Change<span className="sr-only"> from {previousLabel}</span>
        </>
      ),
      meta: { className: `${numeric} text-slate` },
      cell: ({ row }) => <Change figures={row.original.figures} unrecorded={unrecorded} />,
    }),
    helper.display({
      id: "purchases",
      header: "Purchases",
      meta: { className: numeric },
      cell: ({ row }) => row.original.figures.purchases || <Nothing />,
    }),
    helper.display({
      id: "average",
      header: "Average",
      meta: { className: numeric },
      cell: ({ row }) => {
        const average = row.original.figures.averagePurchase;
        return average ? <Amount value={average} cents={false} /> : <Nothing />;
      },
    }),
    helper.display({
      id: "model",
      header: "Model-assigned",
      meta: { className: numeric },
      cell: ({ row }) => {
        const amount = row.original.figures.modelAmount;
        return amount.minor === 0n ? (
          <Nothing />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full border-[1.5px] border-slate"
            />
            <Amount value={amount} cents={false} />
          </span>
        );
      },
    }),
    helper.display({
      id: "months",
      header: "Twelve months",
      meta: { className: "pl-6" },
      cell: ({ row }) => (
        <Sparkline
          label={row.original.label}
          months={months}
          values={row.original.months}
          color={categoryColor(row.original.slug)}
          selected={(month) => period.from <= month && month <= period.to}
        />
      ),
    }),
  ]);
}

// Every part of the open scope, largest first. Each name opens the next level down.
export function BreakdownTable({
  breakdown,
  period,
  previousLabel,
  narrowing,
}: {
  breakdown: SpendingBreakdown;
  period: PeriodChoice;
  previousLabel: string;
  narrowing: Narrowing;
}) {
  const { level, months, rows } = breakdown;
  const unrecorded = breakdown.comparisonCoverage.state === "missing";
  const { from, to, label } = period;
  const { tag, personalEvent } = narrowing;
  const columns = useMemo(
    () =>
      columnsFor({
        level,
        months,
        period: { from, to, label },
        previousLabel,
        unrecorded,
        narrowing: { tag, personalEvent },
      }),
    [level, months, from, to, label, previousLabel, unrecorded, tag, personalEvent],
  );
  const table = useTable({ features, columns, data: rows, getRowId: rowId });
  return (
    <Table className="min-w-[760px] type-body!">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="border-rule hover:bg-transparent">
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                scope="col"
                className={cn(
                  "px-0 type-small font-normal text-slate",
                  header.column.columnDef.meta?.className,
                )}
              >
                <table.FlexRender header={header} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} className="border-rule hover:bg-transparent">
            {row.getAllCells().map((cell) => {
              const meta = cell.column.columnDef.meta;
              return meta?.rowHeader ? (
                <TableHead
                  key={cell.id}
                  scope="row"
                  className={cn("h-auto px-0 py-3 font-normal", meta.className)}
                >
                  <table.FlexRender cell={cell} />
                </TableHead>
              ) : (
                <TableCell key={cell.id} className={cn("px-0 py-3 pl-4", meta?.className)}>
                  <table.FlexRender cell={cell} />
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
