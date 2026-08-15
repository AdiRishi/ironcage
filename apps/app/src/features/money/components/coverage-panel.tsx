import type { BankCoverage, CoverageSpan } from "@ironcage/contracts/schema";
import { type CalendarDate, daysBetween } from "@ironcage/domain";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ironcage/ui/components/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ironcage/ui/components/tooltip";

import { formatSpan } from "@/features/money/format";

/**
 * One account's coverage drawn on a shared date axis: solid where the record
 * can prove every day, hatched warning where it cannot. The whole point of
 * the drawing is that a gap looks like a hole, never like quiet zero.
 */
function CoverageBand({
  covered,
  gaps,
  axis,
}: {
  readonly covered: readonly CoverageSpan[];
  readonly gaps: readonly CoverageSpan[];
  readonly axis: { readonly start: CalendarDate; readonly days: number };
}) {
  const position = (span: CoverageSpan) => {
    const from = Math.max(daysBetween(axis.start, span.start), 0);
    const length = daysBetween(span.start, span.end) + 1;
    return {
      left: `${(from / axis.days) * 100}%`,
      width: `${Math.max((length / axis.days) * 100, 0.6)}%`,
    };
  };

  return (
    <div className="relative h-2.5 overflow-hidden rounded-[4px] bg-chart-fill">
      {covered.map((span) => (
        <Tooltip key={`${span.start}:${span.end}`}>
          <TooltipTrigger
            render={<span className="absolute inset-y-0 rounded-[3px] bg-live/75" style={position(span)} />}
          />
          <TooltipContent>
            <span className="font-mono">covered {formatSpan(span)}</span>
          </TooltipContent>
        </Tooltip>
      ))}
      {gaps.map((span) => (
        <Tooltip key={`${span.start}:${span.end}`}>
          <TooltipTrigger
            render={
              <span
                className="absolute inset-y-0 rounded-[3px]"
                style={{
                  ...position(span),
                  backgroundImage:
                    "repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in oklab, var(--warning) 65%, transparent) 2px 4px)",
                }}
              />
            }
          />
          <TooltipContent>
            <span className="font-mono">gap {formatSpan(span)}</span>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export function CoveragePanel({ coverage }: { readonly coverage: BankCoverage }) {
  const spans = coverage.accounts.flatMap((entry) => [...entry.covered, ...entry.gaps]);
  const starts = spans.map((span) => span.start).sort();
  const ends = spans.map((span) => span.end).sort();
  const axisStart = starts[0];
  const axisEnd = ends[ends.length - 1];
  const axis =
    axisStart === undefined || axisEnd === undefined
      ? undefined
      : { start: axisStart, days: Math.max(daysBetween(axisStart, axisEnd) + 1, 1) };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">Coverage</CardTitle>
        <CardDescription>
          A month needs every day covered in all four accounts before analysis will compare it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {coverage.accounts.map(({ account, covered, gaps }) => (
          <div key={account.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-foreground">
                {account.productLabel}
                {account.maskedSuffix === null ? null : (
                  <span className="ml-2 font-mono text-xs text-ink-faint">
                    ···{account.maskedSuffix}
                  </span>
                )}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {covered.length === 0
                  ? "no history yet"
                  : gaps.length === 0
                    ? "no gaps"
                    : `${gaps.length} ${gaps.length === 1 ? "gap" : "gaps"}`}
              </span>
            </div>
            {axis === undefined || covered.length + gaps.length === 0 ? (
              <div className="h-2.5 rounded-[4px] bg-chart-fill" />
            ) : (
              <CoverageBand covered={covered} gaps={gaps} axis={axis} />
            )}
            {gaps.length > 0 ? (
              <p className="font-mono text-xs text-warning">
                missing {gaps.map((gap) => formatSpan(gap)).join(" · ")}
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
