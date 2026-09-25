import type { CoverageState, PeriodSelection, YearMonth } from "@repo/contracts/finance";
import { monthsPeriod } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Effect } from "effect";

import type { CoverageRead } from "../evidence/basis.ts";
import { TurnEvidence } from "../evidence/service.ts";

// The days of a period each account has records for, as a read whose figures a period
// places, on the spending dates the screens use.
export const coverageOf = Effect.fnUntraced(function* (
  api: Pick<Api, "getCoverage">,
  period: PeriodSelection,
) {
  const evidence = yield* TurnEvidence;
  const read = yield* api.getCoverage({ period, currency: evidence.currency });
  return {
    period: read.period,
    comparison: null,
    basis: "spending",
    calculatedAt: read.calculatedAt,
    accounts: read.coverage,
    comparisonGaps: [],
  } satisfies CoverageRead;
});

// The read of each month of a series that has records, from one read of the days from the
// first such month to the last. The month containing today ends after today, as the
// series' does.
export const monthReads = Effect.fnUntraced(function* (
  api: Pick<Api, "getCoverage">,
  months: ReadonlyArray<{ readonly month: YearMonth; readonly coverage: CoverageState }>,
) {
  const recorded = months.filter((item) => item.coverage !== "missing");
  const first = recorded[0];
  const last = recorded.at(-1);
  if (!first || !last) return new Map<YearMonth, CoverageRead>();
  const span = yield* coverageOf(api, { kind: "months", from: first.month, to: last.month });
  const { endExclusive } = span.period;
  return new Map(
    recorded.map(({ month }) => {
      const whole = monthsPeriod(month);
      const period = {
        start: whole.start,
        endExclusive: whole.endExclusive < endExclusive ? whole.endExclusive : endExclusive,
      };
      return [month, { ...span, period } satisfies CoverageRead];
    }),
  );
});
