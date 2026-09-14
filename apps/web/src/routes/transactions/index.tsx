import { ListPostings, PostingFilter } from "@repo/contracts/finance";
import { PostingCursor } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postingsQueryOptions } from "@/features/transactions/queries";
import { TransactionsTable } from "@/features/transactions/table";
const Search = Schema.Struct({ ...PostingFilter.fields, cursor: Schema.optional(PostingCursor) });
function query(search: typeof Search.Type) {
  const { cursor, ...filter } = search;
  const input: typeof ListPostings.Type = { filter };
  if (cursor) return postingsQueryOptions({ ...input, cursor });
  return postingsQueryOptions(input);
}
export const Route = createFileRoute("/transactions/")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(query(deps)),
  component: TransactionsPage,
});
function TransactionsPage() {
  const { cursor, ...filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useSuspenseQuery(query(Route.useSearch()));
  const [description, setDescription] = useState(filter.description ?? "");
  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Transactions</h1>
        <p className="mt-2 text-muted-foreground">Booked amounts, backed by your bank records.</p>
      </header>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          navigate({ search: { ...filter, description } }).catch(reportError);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Input
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Search bank descriptions"
          />
        </div>
        <Button variant="outline" type="submit">
          Search
        </Button>
        {Object.keys(filter).length > 0 && (
          <Button
            variant="ghost"
            onClick={() => {
              setDescription("");
              navigate({ search: {} }).catch(reportError);
            }}
          >
            Clear filters
          </Button>
        )}
      </form>
      <TransactionsTable rows={data.rows} />
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {data.rows.length} transactions on this page
        </span>
        <div className="flex gap-2">
          {cursor && (
            <Button
              variant="outline"
              onClick={() => {
                navigate({ search: filter }).catch(reportError);
              }}
            >
              First page
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!data.nextCursor}
            onClick={() => {
              if (data.nextCursor)
                navigate({ search: { ...filter, cursor: data.nextCursor } }).catch(reportError);
            }}
          >
            Next page
          </Button>
        </div>
      </div>
    </div>
  );
}
