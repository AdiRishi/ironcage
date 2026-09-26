import type { ListCountedLedger } from "@repo/contracts/finance";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { CountedList } from "@/features/ledger/list";
import { countedLedgerPagesQuery } from "@/features/ledger/queries";

// The records the open scope counts, newest first, on the day each one counts.
export function Transactions({
  input,
  periodLabel,
}: {
  input: Omit<typeof ListCountedLedger.Type, "cursor">;
  periodLabel: string;
}) {
  const history = useSuspenseInfiniteQuery(countedLedgerPagesQuery(input));
  const [first] = history.data.pages;
  if (!first) return null;
  const rows = history.data.pages.flatMap((page) => page.rows);
  return (
    <div className="space-y-6">
      {rows.length === 0 ? (
        <p className="text-slate">
          No transactions count toward this in {periodLabel}. Choose another period above.
        </p>
      ) : (
        <CountedList rows={rows} parts={first.parts} />
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            history.fetchNextPage().catch(reportError);
          }}
        >
          Show older
        </Button>
      )}
    </div>
  );
}
