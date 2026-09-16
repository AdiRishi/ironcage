import type { Contributor, ContributorsResult } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer } from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatMetric, chartValue } from "./labels";
const features = tableFeatures({});
const column = createColumnHelper<typeof features, Contributor>();
const columns = column.columns([
  column.accessor("label", { header: "Contributor" }),
  column.accessor("previous", {
    header: "Previous",
    cell: ({ row }) => formatMetric(row.original.previous.value),
  }),
  column.accessor("current", {
    header: "Current",
    cell: ({ row }) => formatMetric(row.original.current.value),
  }),
  column.accessor("delta", {
    header: "Change",
    cell: ({ row }) => formatMetric(row.original.delta),
  }),
  column.accessor("incomplete", {
    header: "Coverage",
    cell: ({ row }) => (row.original.incomplete ? "Incomplete" : "Complete"),
  }),
]);
export function ContributorsView({ result }: { result: ContributorsResult }) {
  const table = useTable({ features, columns, data: result.rows, getRowId: (row) => row.key });
  return (
    <section className="space-y-5 rounded-lg border p-5">
      <h2 className="text-xl font-semibold">Where the difference came from</h2>
      {result.overlap && (
        <p className="text-sm">
          Groups overlap or are not additive. A record can appear in several groups; do not add
          these rows. No remainder is shown.
        </p>
      )}
      {!result.rows.length && (
        <p>No contributing records in these periods. Import bank history or adjust the filters.</p>
      )}
      {result.rows.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">Show contributor chart</summary>
          <p className="my-3 text-sm">
            Changes sorted by absolute size. Exact values and coverage appear in the table below.
          </p>
          <ChartContainer
            config={{ delta: { label: "Change", color: "var(--primary)" } }}
            className="h-72 w-full"
          >
            <BarChart
              accessibilityLayer
              data={result.rows.map((row) => ({
                key: row.key,
                name: row.label,
                delta: chartValue(row.delta),
              }))}
              layout="vertical"
            >
              <CartesianGrid horizontal={false} />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" width={100} tickLine={false} axisLine={false} />
              <Bar dataKey="delta" fill="var(--color-delta)" radius={3} />
            </BarChart>
          </ChartContainer>
        </details>
      )}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell key={cell.id} className="tabular-nums">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
          {result.remainder && (
            <TableRow>
              <TableCell>Everything else</TableCell>
              <TableCell />
              <TableCell />
              <TableCell>{formatMetric(result.remainder)}</TableCell>
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
      <details>
        <summary className="cursor-pointer font-medium">
          Purchase frequency and average payment
        </summary>
        <p className="my-3 text-sm text-muted-foreground">
          Available for purchase-only groups on total normalization, with purchases in both periods.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              {[
                "Contributor",
                "Previous count",
                "Current count",
                "Previous average",
                "Current average",
                "Frequency contribution",
                "Average-cost contribution",
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.label}</TableCell>
                <TableCell>{row.previous.purchaseCount}</TableCell>
                <TableCell>{row.current.purchaseCount}</TableCell>
                <TableCell>{row.previous.averagePurchase?.value ?? "Unavailable"}</TableCell>
                <TableCell>{row.current.averagePurchase?.value ?? "Unavailable"}</TableCell>
                <TableCell>
                  {row.frequencyContribution
                    ? formatMoney(row.frequencyContribution)
                    : "Unavailable"}
                </TableCell>
                <TableCell>
                  {row.averageCostContribution
                    ? formatMoney(row.averageCostContribution)
                    : "Unavailable"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </section>
  );
}
