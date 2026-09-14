import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { accountsQueryOptions } from "@/features/accounts/queries";

import { TransactionFilters } from "./filters";
import { TransactionSearch, transactionQuery } from "./search";
import { TransactionsTable } from "./table";

export function TransactionsPage({
  search,
  navigate,
}: {
  search: TransactionSearch;
  navigate: (search: TransactionSearch) => Promise<void>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSearch = useRef(search);
  useEffect(() => {
    if (previousSearch.current !== search) heading.current?.focus();
    previousSearch.current = search;
  }, [search]);
  const { cursor, ...filter } = search;
  const { data } = useSuspenseQuery(transactionQuery(search));
  const { data: accounts } = useSuspenseQuery(accountsQueryOptions());
  return (
    <div className="space-y-7">
      <header>
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold tracking-tight">
          Transactions
        </h1>
        <p className="mt-2 text-muted-foreground">Booked amounts, backed by your bank records.</p>
      </header>
      <TransactionFilters
        key={JSON.stringify(filter)}
        filter={filter}
        accounts={accounts}
        onApply={navigate}
      />
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
                navigate(filter).catch(reportError);
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
                navigate({ ...filter, cursor: data.nextCursor }).catch(reportError);
            }}
          >
            Next page
          </Button>
        </div>
      </div>
    </div>
  );
}
