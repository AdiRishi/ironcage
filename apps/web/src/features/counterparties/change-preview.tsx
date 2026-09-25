import type { CounterpartyChangePreview } from "@repo/contracts/finance";

import { ImpactTables, movesTotals } from "@/features/events/impact";

// How many transactions a change gives a new meaning, and the months whose totals it
// moves.
export function ChangePreview({
  eventCount,
  impacts,
}: Pick<typeof CounterpartyChangePreview.Type, "eventCount" | "impacts">) {
  const moved = impacts.filter(movesTotals);
  const changes =
    eventCount === 0
      ? "Changes no transactions"
      : `Changes ${eventCount} ${eventCount === 1 ? "transaction" : "transactions"}`;
  if (moved.length === 0) return <p>{changes}; totals stay the same.</p>;
  return (
    <div className="space-y-3">
      <p>{changes}.</p>
      <ImpactTables impacts={moved} />
    </div>
  );
}
