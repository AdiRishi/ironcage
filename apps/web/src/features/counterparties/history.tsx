import type { Counterparty, ReferenceData } from "@repo/contracts/finance";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { HistoryEntry } from "@/features/history/entry";

import { counterpartyHistoryQuery } from "./queries";

// Every change to a counterparty, its descriptors, and its reference defaults, newest
// first. Undoing its creation removes the counterparty, so the page leaves for the list.
export function CounterpartyHistory({
  counterparty,
  references,
  timeZone,
}: {
  counterparty: Counterparty;
  references: typeof ReferenceData.Type;
  timeZone: string;
}) {
  const navigate = useNavigate();
  const history = useSuspenseInfiniteQuery(
    counterpartyHistoryQuery({ counterpartyId: counterparty.id }),
  );
  const rows = history.data.pages.flatMap((page) => page.rows);
  return (
    <section aria-labelledby="history-heading" className="space-y-3 border-t border-rule pt-8">
      <h2 id="history-heading" className="type-heading">
        History
      </h2>
      {rows.length === 0 ? (
        <p className="text-slate">You have not changed {counterparty.name} yet.</p>
      ) : (
        <ol className="divide-y divide-rule border-y border-rule">
          {rows.map((change) => (
            <li key={change.id}>
              <HistoryEntry
                entry={{ kind: "counterparty", change }}
                references={references}
                timeZone={timeZone}
                onUndone={async ({ removed }) => {
                  if (removed.includes(counterparty.id)) await navigate({ to: "/counterparties" });
                }}
              />
            </li>
          ))}
        </ol>
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            history.fetchNextPage().catch(reportError);
          }}
        >
          {history.isFetchingNextPage ? "Loading…" : "Show earlier changes"}
        </Button>
      )}
    </section>
  );
}
