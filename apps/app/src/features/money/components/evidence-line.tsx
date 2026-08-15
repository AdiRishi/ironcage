import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { formatAgo, formatDay } from "@/features/money/format";
import { coverageQuery } from "@/features/money/queries";

/**
 * The line every Money surface opens with: how far the record runs and when
 * it last moved. `docs/technical/11-app.md` forbids a value rendering as
 * current without freshness evidence — this is that evidence, stated before
 * any figure gets to speak.
 */
export function EvidenceLine() {
  const coverage = useQuery(coverageQuery);

  if (coverage.isPending) return <Skeleton className="h-4 w-80" />;

  if (coverage.isError) {
    return (
      <p className="font-mono text-xs tracking-wide text-destructive">
        Coverage unavailable — {String(coverage.error)}
      </p>
    );
  }

  const { dataThrough, freshestImportAt, completeMonths } = coverage.data;

  if (dataThrough === null || freshestImportAt === null) {
    return (
      <p className="font-mono text-xs tracking-wide text-muted-foreground">
        The record is empty — nothing has been imported yet.
      </p>
    );
  }

  const months = completeMonths.length;

  return (
    <p className="font-mono text-xs tracking-wide text-muted-foreground">
      Data through <span className="text-foreground">{formatDay(dataThrough)}</span>
      <span className="mx-2 text-ink-faint">·</span>
      imported {formatAgo(freshestImportAt)}
      <span className="mx-2 text-ink-faint">·</span>
      {months === 0 ? "no complete months yet" : `${months} complete ${months === 1 ? "month" : "months"}`}
    </p>
  );
}
