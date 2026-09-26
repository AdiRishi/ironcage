import { PgClient } from "@effect/sql-pg";
import { type ComparisonSelection, Instant, type PeriodSelection } from "@repo/contracts/finance";
import { calendarDateIn, comparisonPeriod, resolvePeriod } from "@repo/finance";
import { DateTime, Effect, Schema } from "effect";

// Today in the settings timezone, and the instant it was taken for `calculatedAt`.
export const readToday = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const [settings] = yield* sql`SELECT timezone FROM settings WHERE id = 1`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ timezone: Schema.String })])),
    ),
  );
  const now = yield* DateTime.now;
  return {
    today: calendarDateIn(now, settings.timezone),
    calculatedAt: Instant.make(DateTime.formatIso(now)),
  };
});

export const resolveSelection = Effect.fn("resolveSelection")(function* (
  selection: PeriodSelection,
) {
  const { today, calculatedAt } = yield* readToday;
  const period = yield* Effect.fromResult(resolvePeriod(selection, today));
  return { period, calculatedAt };
});

export const resolvePeriods = Effect.fn("resolvePeriods")(function* (input: {
  readonly period: PeriodSelection;
  readonly comparison: typeof ComparisonSelection.Type;
}) {
  const { period, calculatedAt } = yield* resolveSelection(input.period);
  const comparison = yield* Effect.fromResult(
    comparisonPeriod(input.period, input.comparison, period),
  );
  return { period, comparison, calculatedAt };
});
