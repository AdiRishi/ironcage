import type { AnalysisRow, AnalysisRowsInput } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { Coverage } from "./coverage";
import { formatMetric } from "./labels";
import { analysisRowsQuery } from "./queries";
import { ComparisonHeadline } from "./trends";
const features = tableFeatures({});
const column = createColumnHelper<typeof features, AnalysisRow>();
const columns = column.columns([
  column.accessor("period", { header: "Period" }),
  column.accessor("on", { header: "Basis date" }),
  column.accessor("posting", {
    header: "Bank record",
    cell: ({ row }) => (
      <div>
        <Link
          className="underline underline-offset-4"
          to="/transactions/$id"
          params={{ id: row.original.posting.id }}
        >
          {row.original.posting.description}
        </Link>
        <p className="text-xs text-muted-foreground">
          {row.original.posting.accountLabel}, posted {row.original.posting.postedOn}
        </p>
      </div>
    ),
  }),
  column.accessor("contribution", {
    header: "Calculated contribution",
    cell: ({ row }) => formatMetric(row.original.contribution),
  }),
  column.display({
    id: "bankAmount",
    header: "Bank amount",
    cell: ({ row }) => formatMoney(row.original.posting.amount),
  }),
  column.display({
    id: "evidence",
    header: "Credits and counterparts",
    cell: ({ row }) => (
      <div className="min-w-40 space-y-1">
        {row.original.credits.map((credit) => (
          <p key={credit.id}>Applied credit {formatMoney(credit.amount)}</p>
        ))}
        {row.original.counterparts.map((posting) => (
          <p key={posting.id}>
            <Link className="underline" to="/transactions/$id" params={{ id: posting.id }}>
              {posting.accountLabel}, {posting.postedOn}, {formatMoney(posting.amount)}
            </Link>
          </p>
        ))}
        {!row.original.credits.length && !row.original.counterparts.length && "None"}
      </div>
    ),
  }),
]);
export function AnalysisRowsPage({
  input,
  onPage,
}: {
  input: AnalysisRowsInput;
  onPage: (input: AnalysisRowsInput) => Promise<void>;
}) {
  const result = useSuspenseQuery(analysisRowsQuery(input));
  const table = useTable({
    features,
    columns,
    data: result.data.rows,
    getRowId: (row) => `${row.period}:${row.id}`,
  });
  return (
    <div className="space-y-6">
      <Link
        className="text-sm underline"
        to="/trends"
        search={{ query: input.query, groupBy: input.groupBy }}
      >
        Back to Trends
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{result.data.label}</h1>
        <Button
          variant="outline"
          onClick={() => {
            result.refetch().catch(reportError);
          }}
        >
          Refresh rows and headline
        </Button>
      </header>
      <p className="text-muted-foreground">
        Contributions use the selected measure and basis. Bank amounts keep their original dates and
        signs.
      </p>
      <ComparisonHeadline result={result.data.headline} />
      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Current period coverage">
          <h2 className="mb-2 font-medium">Current period</h2>
          <Coverage coverage={result.data.headline.current.coverage} />
        </section>
        <section aria-label="Previous period coverage">
          <h2 className="mb-2 font-medium">Previous period</h2>
          <Coverage coverage={result.data.headline.previous.coverage} />
        </section>
      </div>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  <table.FlexRender header={header} />
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
        </TableBody>
      </Table>
      {!result.data.rows.length && (
        <p>No records match this contributor now. Its fresh headline is shown above.</p>
      )}
      <div className="flex gap-3">
        {input.cursor && (
          <Button
            variant="outline"
            onClick={() => {
              onPage({
                query: input.query,
                groupBy: input.groupBy,
                groupKey: input.groupKey,
              }).catch(reportError);
            }}
          >
            First page
          </Button>
        )}
        {result.data.nextCursor && (
          <Button
            onClick={() => {
              const cursor = result.data.nextCursor;
              if (cursor) onPage({ ...input, cursor }).catch(reportError);
            }}
          >
            Next page
          </Button>
        )}
      </div>
    </div>
  );
}
