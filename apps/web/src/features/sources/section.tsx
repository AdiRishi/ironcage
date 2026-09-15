import { type SourceFile } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { sourceFilesQueryOptions } from "./queries";
import { RemoveSourceDialog } from "./remove-dialog";

const features = tableFeatures({});
const column = createColumnHelper<typeof features, SourceFile>();
const columns = column.columns([
  column.accessor("fileName", {
    header: "File",
    cell: ({ row }) => (
      <div className="max-w-sm min-w-40 space-y-1 break-words whitespace-normal">
        <p className="font-medium">{row.original.fileName}</p>
        <p className="text-xs text-muted-foreground">
          {row.original.format.toUpperCase()} · {BigInt(row.original.byteSize).toLocaleString()}{" "}
          bytes · {row.original.status.replace("_", " ")}
        </p>
        <Link
          to="/transactions"
          search={{ importId: row.original.importId }}
          className="text-xs underline underline-offset-4"
        >
          {row.original.postingCount.toLocaleString()} supported transactions
        </Link>
      </div>
    ),
  }),
  column.accessor("bytesAvailable", {
    header: "Original",
    cell: ({ row }) =>
      row.original.bytesAvailable ? (
        <a className="text-sm underline underline-offset-4" href={`/sources/${row.original.id}`}>
          Open file
        </a>
      ) : (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Unavailable</p>
          <Link to="/imports" className="text-sm underline underline-offset-4">
            Reupload
          </Link>
        </div>
      ),
  }),
  column.display({
    id: "remove",
    header: "Manage",
    cell: ({ row }) => <RemoveSourceDialog file={row.original} />,
  }),
]);
export function SourceFilesSection() {
  const { data } = useSuspenseQuery(sourceFilesQueryOptions());
  const table = useTable({ features, columns, data, getRowId: (row) => row.id });
  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Source files</h2>
        <p className="text-sm text-muted-foreground">
          Remove original bytes while keeping the financial records. Reuploading the same file
          restores access.
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border">
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
                  <TableCell key={cell.id} className="py-4 align-top">
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {data.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">No files imported yet.</p>
        )}
      </div>
    </section>
  );
}
