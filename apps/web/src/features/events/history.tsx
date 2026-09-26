import type { EventId, ReferenceData } from "@repo/contracts/finance";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { HistoryEntry } from "@/features/history/entry";
import { settingsQueryOptions } from "@/features/settings/queries";

import { eventHistoryQuery } from "./queries";

// Every change that set something on this transaction, newest first: its own
// corrections and the counterparty changes that reached it.
export function EventHistory({
  eventId,
  references,
}: {
  eventId: typeof EventId.Type;
  references: typeof ReferenceData.Type;
}) {
  const history = useQuery(eventHistoryQuery(eventId));
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  return (
    <section aria-labelledby="event-history-heading" className="space-y-2">
      <h3 id="event-history-heading" className="font-[560]">
        History
      </h3>
      {history.isPending && <output className="text-slate">Loading history…</output>}
      {history.error && (
        <p role="alert">
          {history.error.message}{" "}
          <Button
            variant="link"
            onClick={() => {
              history.refetch().catch(reportError);
            }}
          >
            Retry
          </Button>
        </p>
      )}
      {history.data?.entries.length === 0 && (
        <p className="type-small text-slate">No changes yet.</p>
      )}
      {history.data && history.data.entries.length > 0 && (
        <ol className="divide-y divide-rule border-y border-rule">
          {history.data.entries.map((entry) => (
            <li key={entry.kind === "correction" ? entry.correction.id : entry.change.id}>
              <HistoryEntry
                entry={
                  entry.kind === "correction" ? { ...entry, names: history.data.names } : entry
                }
                references={references}
                timeZone={settings.timezone}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
