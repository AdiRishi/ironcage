import { formatFullDay, type CoverageGap, type MoneyCoverage } from "@ironcage/domain";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Skeleton } from "@ironcage/ui/components/skeleton";
import { cn } from "@ironcage/ui/lib/utils";

import type { BoundaryFailure } from "@/features/money/queries";
import { boundaryFailure } from "@/features/money/queries";

/** The eyebrow every panel on this surface is titled with. */
export function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[0.6875rem] tracking-[0.14em] text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  readonly title: React.ReactNode;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex min-h-8 items-center justify-between gap-4">
        <PanelTitle>{title}</PanelTitle>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * One figure, in the display face at a size that survives being glanced at.
 * `value` is a node rather than a string so a caller can render an absence as
 * an em dash without this component deciding what missing money looks like.
 */
export function Metric({
  label,
  value,
  note,
  tone = "default",
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly note?: string;
  readonly tone?: "default" | "live" | "halted" | "muted";
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
      <span className="font-mono text-[0.6875rem] tracking-[0.12em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-2xl tabular-nums",
          tone === "live" && "text-live",
          tone === "halted" && "text-halted",
          tone === "muted" && "text-ink-faint",
        )}
      >
        {value}
      </span>
      {note !== undefined && <span className="text-xs text-muted-foreground">{note}</span>}
    </div>
  );
}

/**
 * A coverage gap, rendered as the absence it is.
 *
 * The product rule this exists for: a month the record cannot vouch for is
 * never drawn as a month with low spending. The figures are withheld and the
 * missing windows are named instead.
 */
export function CoverageNotice({
  coverage,
  accountLabels,
}: {
  readonly coverage: MoneyCoverage;
  readonly accountLabels: ReadonlyMap<string, string>;
}) {
  if (coverage._tag === "Complete") return null;

  return (
    <Alert className="border-warning/40">
      <AlertTitle className="text-warning">This month is not complete</AlertTitle>
      <AlertDescription>
        {coverage.gaps.length === 0 ? (
          <p>
            No account is required yet, so nothing vouches for this month. Register the four
            accounts and import their windows.
          </p>
        ) : (
          <>
            <p>
              Spending is withheld rather than shown as zero. Import the windows below, then this
              month becomes available.
            </p>
            <ul className="mt-1 flex flex-col gap-1 font-mono text-xs">
              {coverage.gaps.map((gap) => (
                <li key={`${gap.accountId}-${gap.start}`}>
                  {accountLabels.get(gap.accountId) ?? gap.accountId} · {gapWindow(gap)}
                </li>
              ))}
            </ul>
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}

const gapWindow = (gap: CoverageGap) =>
  gap.start === gap.end
    ? formatFullDay(gap.start)
    : `${formatFullDay(gap.start)} to ${formatFullDay(gap.end)}`;

const failureTitle = (failure: BoundaryFailure) => {
  switch (failure._tag) {
    case "ValidationFailed":
      return failure.reason;
    case "Conflict":
      return failure.reason;
    case "Stale":
      return failure.reason;
    case "NotFound":
      return `No such ${failure.entity}`;
    case "Internal":
      return "The record could not be read";
  }
};

const failureDetail = (failure: BoundaryFailure) =>
  failure._tag === "NotFound" ? failure.id : failure.detail;

/**
 * A refused call, rendered as the explanation core sent rather than as a stack
 * trace. Every reason on the money surface names something the operator can do:
 * re-preview, re-export, resolve a row.
 */
export function CallFailure({ error }: { readonly error: unknown }) {
  const failure = boundaryFailure(error);

  if (failure === null) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unavailable</AlertTitle>
        <AlertDescription>{String(error)}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertTitle className="font-mono text-xs tracking-wide">{failureTitle(failure)}</AlertTitle>
      <AlertDescription>{failureDetail(failure)}</AlertDescription>
    </Alert>
  );
}

export function PanelSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} className="h-5 w-full" />
      ))}
    </div>
  );
}
