import type { MonthAnalysis } from "@ironcage/contracts/schema";
import { Card, CardContent, CardHeader } from "@ironcage/ui/components/card";

import { Eyebrow } from "@/features/money/components/eyebrow";
import { formatRate } from "@/features/money/format";

const W = 280;
const H = 64;
const PAD = 4;

/**
 * Savings rate across the last twelve months. Only a complete month with
 * income earns a point; the line breaks where a month is incomplete, so a
 * coverage gap reads as a gap and never as a dip.
 */
export function SavingsRateTrend({ months }: { readonly months: readonly MonthAnalysis[] }) {
  const shown = months.slice(-12);
  const rates = shown.map((month) =>
    month.complete && month.savingsRate !== null ? Number.parseFloat(month.savingsRate) : null,
  );
  const known = rates.filter((rate): rate is number => rate !== null);

  if (known.length < 2) {
    return (
      <Card>
        <CardHeader>
          <Eyebrow>Savings rate · 12 months</Eyebrow>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Needs two complete months with income before a trend means anything.
          </p>
        </CardContent>
      </Card>
    );
  }

  const min = Math.min(0, ...known);
  const max = Math.max(...known, 0.05);
  const x = (index: number) => PAD + (index / Math.max(shown.length - 1, 1)) * (W - PAD * 2);
  const y = (rate: number) => H - PAD - ((rate - min) / (max - min)) * (H - PAD * 2);
  const mean = known.reduce((sum, rate) => sum + rate, 0) / known.length;
  const latest = known[known.length - 1]!;

  const segments: string[] = [];
  let current: string[] = [];
  rates.forEach((rate, index) => {
    if (rate === null) {
      if (current.length > 0) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${x(index)},${y(rate)}`);
  });
  if (current.length > 0) segments.push(current.join(" "));

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Savings rate · 12 months</Eyebrow>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-16 w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1={0}
            x2={W}
            y1={y(mean)}
            y2={y(mean)}
            className="stroke-border"
            strokeDasharray="3 3"
          />
          {segments.map((points) => (
            <polyline
              key={points}
              points={points}
              fill="none"
              className="stroke-live"
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {rates.map((rate, index) =>
            rate === null ? null : (
              <circle
                key={shown[index]!.month}
                cx={x(index)}
                cy={y(rate)}
                r={index === rates.length - 1 ? 2.5 : 1.5}
                className="fill-live"
              />
            ),
          )}
        </svg>
        <p className="font-mono text-[11px] text-muted-foreground">
          now <span className="text-foreground">{formatRate(String(latest))}</span>
          <span className="mx-2 text-ink-faint">·</span>
          12-mo mean {formatRate(String(mean))}
          {rates.some((rate) => rate === null) ? (
            <>
              <span className="mx-2 text-ink-faint">·</span>
              gaps are incomplete months
            </>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}
