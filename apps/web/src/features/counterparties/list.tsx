import type {
  CounterpartyList,
  CounterpartySummary,
  FlowDirection,
  ReferenceData,
} from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, metaHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { cn } from "cn";
import { useMemo, useState } from "react";

import { Amount } from "@/components/amount";
import { ProvenanceMark } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { categoryColor } from "@/lib/category-colors";
import type { PeriodChoice } from "@/lib/period";

import { kindLabels } from "./choices";

type Summary = typeof CounterpartySummary.Type;
type Categories = (typeof ReferenceData.Type)["categories"];

const directions = [
  { value: "out", label: "Money out", amount: "Paid" },
  { value: "in", label: "Money in", amount: "Received" },
] as const satisfies ReadonlyArray<{ value: FlowDirection; label: string; amount: string }>;

// `rowHeader` renders the column's cells as the row's header, which names the row.
const features = tableFeatures({
  columnMeta: metaHelper<{ className: string; rowHeader?: boolean }>(),
});
const helper = createColumnHelper<typeof features, Summary>();
const narrow = "max-sm:hidden";

function columnsFor(direction: (typeof directions)[number], categories: Categories) {
  const outgoing = direction.value === "out";
  return helper.columns([
    helper.display({
      id: "name",
      header: "Counterparty",
      meta: { className: "w-full max-w-0", rowHeader: true },
      cell: ({ row: { original: row } }) => (
        <span className="flex min-w-0 items-center gap-2">
          <Link
            to="/counterparties/$counterpartyId"
            params={{ counterpartyId: row.id }}
            className="truncate rounded-sm font-[520] hover:text-intaglio hover:underline"
          >
            {row.name}
          </Link>
          <ProvenanceMark
            assignedBy={row.source === "user" ? "you" : "model"}
            question={row.status === "proposed" || (row.kind === "person" && !row.defaultRole)}
          />
        </span>
      ),
    }),
    helper.display({
      id: "kind",
      header: "Kind",
      meta: { className: `${narrow} whitespace-nowrap text-slate` },
      cell: ({ row }) => kindLabels[row.original.kind],
    }),
    helper.display({
      id: "category",
      header: "Usual category",
      meta: { className: "max-w-40" },
      cell: ({ row }) => {
        const category = categories.find((item) => item.id === row.original.defaultCategoryId);
        return category ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: categoryColor(category.slug) }}
            />
            <span className="truncate">{category.name}</span>
          </span>
        ) : (
          <span className="text-slate">None</span>
        );
      },
    }),
    helper.display({
      id: "count",
      header: "Transactions",
      meta: { className: `${narrow} text-right tabular` },
      cell: ({ row }) => (outgoing ? row.original.outflowEvents : row.original.inflowEvents),
    }),
    helper.display({
      id: "amount",
      header: direction.amount,
      meta: { className: "text-right tabular whitespace-nowrap" },
      cell: ({ row }) => (
        <Amount value={outgoing ? row.original.outflow : row.original.inflow} cents={false} />
      ),
    }),
  ]);
}

// Counterparties in one direction, largest amount first. One whose refunds exceed its
// purchases comes last, with its net amount.
function CounterpartyTable({
  rows,
  direction,
  categories,
}: {
  rows: typeof CounterpartyList.Type;
  direction: (typeof directions)[number];
  categories: Categories;
}) {
  const columns = useMemo(() => columnsFor(direction, categories), [direction, categories]);
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.id });
  return (
    <Table className="type-body!">
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="border-rule hover:bg-transparent">
            {group.headers.map((header) => (
              <TableHead
                key={header.id}
                scope="col"
                className={cn(
                  "px-0 pl-4 type-small font-normal text-slate first:pl-0",
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
          <TableRow key={row.id} className="border-rule hover:bg-sheet">
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

export function CounterpartiesPage({
  counterparties,
  references,
  period,
  direction,
  search,
  onSearch,
  onDirection,
}: {
  counterparties: typeof CounterpartyList.Type;
  references: typeof ReferenceData.Type;
  period: PeriodChoice;
  direction: FlowDirection;
  search: string;
  onSearch: (search: string) => void;
  onDirection: (direction: FlowDirection) => void;
}) {
  const [text, setText] = useState(search);
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Counterparties</h1>
          <p className="mt-1 type-small text-slate">
            Who you {direction === "out" ? "paid" : "received money from"} in {period.label}.
          </p>
        </div>
        <search className="w-full sm:w-auto">
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              onSearch(text);
            }}
          >
            <Input
              aria-label="Search names and descriptors"
              placeholder="Search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="sm:w-64"
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
          </form>
        </search>
      </header>
      <Tabs
        value={direction}
        onValueChange={(value) => {
          const next = directions.find((item) => item.value === value);
          if (next) onDirection(next.value);
        }}
        className="gap-4"
      >
        <TabsList variant="line">
          {directions.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {directions.map((item) => (
          <TabsContent key={item.value} value={item.value}>
            {counterparties.length === 0 ? (
              <p className="type-body text-slate">
                {search
                  ? `No counterparties match “${search}” in ${period.label}.`
                  : `Nothing ${item.value === "out" ? "went out" : "came in"} in ${period.label}.`}
              </p>
            ) : (
              <CounterpartyTable
                rows={counterparties}
                direction={item}
                categories={references.categories}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
