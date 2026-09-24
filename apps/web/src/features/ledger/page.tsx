import type { Account, LedgerPage as LedgerResult } from "@repo/contracts/finance";
import { Struct } from "effect";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ResolvedPeriod } from "@/lib/period";

import { TransactionFilters } from "./filters";
import { LedgerList } from "./list";
import type { LedgerSearch } from "./search";

export function LedgerPage({
  search,
  period,
  page,
  accounts,
  navigate,
}: {
  search: LedgerSearch;
  period: ResolvedPeriod;
  page: typeof LedgerResult.Type;
  accounts: readonly Account[];
  navigate: (search: LedgerSearch) => void;
}) {
  const { cursor, ...filter } = search;
  const [text, setText] = useState(filter.description ?? "");
  const scope = filter.importId
    ? "One file"
    : filter.from || filter.to
      ? "Chosen dates"
      : period.label;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-title">Ledger</h1>
          <p className="mt-1 type-small text-slate">
            {scope}. Every transaction, what it means, and its evidence.
          </p>
        </div>
        <search className="w-full sm:w-auto">
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              const rest = Struct.omit(filter, ["description"]);
              navigate(text.trim() ? { ...rest, description: text.trim() } : rest);
            }}
          >
            <Input
              aria-label="Search descriptions and counterparties"
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
      <details className="group rounded-lg border border-rule bg-sheet">
        <summary className="cursor-pointer list-none px-4 py-3 text-slate hover:text-intaglio">
          More filters
        </summary>
        <div className="border-t border-rule p-4">
          <TransactionFilters
            key={JSON.stringify(filter)}
            filter={filter}
            accounts={accounts}
            onApply={async (next) => navigate(next)}
          />
        </div>
      </details>
      {page.rows.length === 0 ? (
        <p className="text-slate">No transactions match. Try another period or fewer filters.</p>
      ) : (
        <LedgerList rows={page.rows} />
      )}
      <div className="flex items-center justify-end gap-2">
        {cursor && (
          <Button variant="outline" onClick={() => navigate(filter)}>
            Back to the newest
          </Button>
        )}
        <Button
          variant="outline"
          disabled={!page.nextCursor}
          onClick={() => {
            if (page.nextCursor) navigate({ ...filter, cursor: page.nextCursor });
          }}
        >
          Older transactions
        </Button>
      </div>
    </div>
  );
}
