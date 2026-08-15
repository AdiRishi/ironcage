import type { Observed } from "@ironcage/contracts/schema";
import type { Aud } from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import { DateTime } from "effect";
import { useEffect, useState } from "react";

import { formatAgo, formatAud } from "@/features/money/format";

export function ObservedAmount({ observed }: { readonly observed: Observed<typeof Aud.Type> }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  if (observed._tag === "Unknown") {
    return (
      <span className="flex items-center gap-2">
        <span className="font-mono text-muted-foreground">Unknown</span>
        <Badge variant="outline">{observed.reason}</Badge>
      </span>
    );
  }

  const stale = observed._tag === "Stale" || DateTime.toEpochMillis(observed.staleAfter) <= now;
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="font-mono font-semibold tabular-nums">{formatAud(observed.value)}</span>
      <Badge variant="outline" className={stale ? "text-warning" : "text-live"}>
        {stale ? "stale" : `as of ${formatAgo(observed.asOf, now)}`}
      </Badge>
    </span>
  );
}
