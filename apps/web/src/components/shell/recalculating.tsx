import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { factsStatusQuery } from "@/features/flow/queries";

// Totals read facts that a background rebuild is recalculating after an update. When it
// finishes, every screen refetches so no figure keeps a mix of old and new facts.
export function Recalculating() {
  const outdated = useQuery(factsStatusQuery()).data?.outdated ?? 0;
  const client = useQueryClient();
  const wasOutdated = useRef(false);
  useEffect(() => {
    if (outdated > 0) wasOutdated.current = true;
    else if (wasOutdated.current) {
      wasOutdated.current = false;
      client.invalidateQueries().catch(reportError);
    }
  }, [client, outdated]);
  if (outdated === 0) return null;
  return (
    <output className="block border-b border-rule bg-sheet">
      <span className="mx-auto block max-w-[1280px] px-5 py-2 type-small text-slate md:px-8">
        Recalculating totals after an update: {outdated.toLocaleString("en-AU")} transactions left.
        Figures may be incomplete until it finishes.
      </span>
    </output>
  );
}
