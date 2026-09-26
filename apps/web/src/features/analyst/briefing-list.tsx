import type { BriefingSummary } from "@repo/contracts/analyst";
import { monthLabel } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { settingsQueryOptions } from "@/features/settings/queries";
import { instantLabel } from "@/lib/time";

import { briefingAnchor } from "./briefing";
import { briefingsQuery } from "./queries";
import { briefingOverview, recordLink } from "./record-link";

const unwritten = {
  writing: "Writing…",
  blocked: "Not written yet",
  failed: "Could not be written",
} satisfies Record<Exclude<BriefingSummary["status"], "ready">, string>;

// The latest months' briefings, newest first, each opening its month's overview at the
// briefing. The list says how each write ended without reading the ledger again, so the
// overview checks a written briefing against the figures now.
export function BriefingList() {
  const id = useId();
  const { data: briefings } = useSuspenseQuery(briefingsQuery());
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4">
      <h2 id={`${id}-heading`} className="type-heading">
        Briefings
      </h2>
      {briefings.length === 0 ? (
        <p className="max-w-prose type-small text-slate">
          The analyst writes a briefing of each month once it ends, and the month's overview shows
          it.
        </p>
      ) : (
        <ul className="-mx-2 max-w-md space-y-1">
          {briefings.map((briefing) => (
            <li key={briefing.month}>
              <Link
                {...recordLink(briefingOverview(briefing.month))}
                hash={briefingAnchor}
                className="block rounded-md px-2 py-1.5 hover:bg-sheet"
              >
                {monthLabel(briefing.month)}
                <span className="block type-small text-slate">
                  {briefing.status === "ready"
                    ? `Written ${instantLabel(briefing.writtenAt, settings.timezone)}`
                    : unwritten[briefing.status]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
