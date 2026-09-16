import { PgClient } from "@effect/sql-pg";
import {
  CalendarDate,
  FinanceError,
  type OverviewInput,
  type OverviewResult,
} from "@repo/contracts/finance";
import { calculateOverview, resolvePeriod } from "@repo/finance";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { toFinanceError } from "../database/failures.ts";
import { readAnalysisSnapshot } from "./snapshot.ts";

export class Analysis extends Context.Service<
  Analysis,
  {
    readonly overview: (input: OverviewInput) => Effect.Effect<OverviewResult, FinanceError>;
  }
>()("@repo/api/analysis/Analysis") {
  static readonly layer = Layer.effect(
    Analysis,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const overview = Effect.fn("Analysis.overview")(
        (input: OverviewInput) =>
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
              const [settings] = yield* sql`SELECT timezone FROM settings WHERE id=1`.pipe(
                Effect.flatMap(
                  Schema.decodeUnknownEffect(
                    Schema.Tuple([Schema.Struct({ timezone: Schema.String })]),
                  ),
                ),
              );
              const now = yield* DateTime.now;
              const today = CalendarDate.make(
                DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(now, settings.timezone)),
              );
              const period = resolvePeriod(input.period, today);
              return calculateOverview(
                yield* readAnalysisSnapshot(input),
                input,
                period,
                DateTime.formatIso(now),
              );
            }),
          ),
        Effect.provideService(PgClient.PgClient, sql),
        toFinanceError,
      );
      return Analysis.of({ overview });
    }),
  );
}
