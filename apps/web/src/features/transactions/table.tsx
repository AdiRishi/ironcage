import { Posting } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";

import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
const features = tableFeatures({});
const column = createColumnHelper<typeof features, Posting>();
const columns = column.columns([
  column.accessor("postedOn", { header: "Date" }),
  column.accessor("description", {
    header: "Description",
    cell: ({ row }) => (
      <Link
        to="/transactions/$id"
        params={{ id: row.original.id }}
        className="font-medium text-foreground underline-offset-4 hover:underline focus:underline"
      >
        {row.original.description}
      </Link>
    ),
  }),
  column.accessor("accountLabel", { header: "Account" }),
  column.accessor("amount", {
    header: "Amount",
    cell: ({ row }) => (
      <span className="block text-right font-mono tabular-nums">
        {formatMoney(row.original.amount)}
      </span>
    ),
  }),
]);
export function TransactionsTable({ rows }: { rows: ReadonlyArray<Posting> }) {
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.id });
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id} className="last:text-right">
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
                <TableCell key={cell.id} className="py-4">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>No transactions match these filters.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
