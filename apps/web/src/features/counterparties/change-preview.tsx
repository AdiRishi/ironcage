import type { CounterpartyChangePreview } from "@repo/contracts/finance";

import { type ImpactHeading, ImpactSummary, movesTotals } from "@/features/events/impact";

// How many transactions a change gives a new meaning, and the months whose totals it
// moves.
export function ChangePreview({
  eventCount,
  impacts,
  heading,
}: Pick<typeof CounterpartyChangePreview.Type, "eventCount" | "impacts"> & {
  heading?: ImpactHeading;
}) {
  const changes =
    eventCount === 0
      ? "Changes no transactions"
      : `Changes ${eventCount} ${eventCount === 1 ? "transaction" : "transactions"}`;
  if (!impacts.some(movesTotals)) return <p>{changes}; totals stay the same.</p>;
  return (
    <div className="space-y-3">
      <p>{changes}.</p>
      <ImpactSummary impacts={impacts} heading={heading} />
    </div>
  );
}
