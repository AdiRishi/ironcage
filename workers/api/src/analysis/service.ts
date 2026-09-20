import { PgClient } from "@effect/sql-pg";
import {
  CalendarDate,
  FinanceError,
  type AnalysisQuery,
  type AnalysisRowsInput,
  type AnalysisRowsResult,
  type ComparisonResult,
  type ContributorsInput,
  type ContributorsResult,
  type OverviewInput,
  type OverviewResult,
} from "@repo/contracts/finance";
import {
  calculateRows,
  calculateComparison,
  calculateContributors,
  calculateOverview,
  comparisonPeriod,
  resolvePeriod,
} from "@repo/finance";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql";

import { toFinanceError } from "../database/failures.ts";
import { readAnalysisSnapshot } from "./snapshot.ts";

export class Analysis extends Context.Service<
  Analysis,
  {
    readonly rows: (input: AnalysisRowsInput) => Effect.Effect<AnalysisRowsResult, FinanceError>;
    readonly overview: (input: OverviewInput) => Effect.Effect<OverviewResult, FinanceError>;
    readonly compare: (input: AnalysisQuery) => Effect.Effect<ComparisonResult, FinanceError>;
    readonly contributors: (
      input: typeof ContributorsInput.Type,
    ) => Effect.Effect<ContributorsResult, FinanceError>;
  }
>()("@repo/api/analysis/Analysis") {
  static readonly layer = Layer.effect(
    Analysis,
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient;
      const context = Effect.fn("Analysis.context")(function* (input: OverviewInput) {
        const [settings] = yield* sql`SELECT timezone FROM settings WHERE id=1`.pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ timezone: Schema.String })])),
          ),
        );
        const now = yield* DateTime.now;
        const today = CalendarDate.make(
          DateTime.formatIsoDate(DateTime.setZoneNamedUnsafe(now, settings.timezone)),
        );
        const period = yield* Effect.fromResult(resolvePeriod(input.period, today));
        return {
          snapshot: yield* readAnalysisSnapshot(input),
          period,
          calculatedAt: DateTime.formatIso(now),
        };
      });
      const read = <A>(
        effect: Effect.Effect<
          A,
          FinanceError | Schema.SchemaError | SqlError.SqlError,
          PgClient.PgClient
        >,
      ) =>
        sql
          .withTransaction(
            Effect.gen(function* () {
              yield* sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
              return yield* effect;
            }),
          )
          .pipe(Effect.provideService(PgClient.PgClient, sql), toFinanceError);
      const overview = Effect.fn("Analysis.overview")((input: OverviewInput) =>
        read(
          Effect.gen(function* () {
            const data = yield* context(input);
            return calculateOverview(data.snapshot, input, data.period, data.calculatedAt);
          }),
        ),
      );
      const compare = Effect.fn("Analysis.compare")((query: AnalysisQuery) =>
        read(
          Effect.gen(function* () {
            const data = yield* context(query);
            return calculateComparison(
              data.snapshot,
              query,
              {
                current: data.period,
                previous: yield* Effect.fromResult(
                  comparisonPeriod(query.period, query.comparison, data.period),
                ),
              },
              data.calculatedAt,
            );
          }),
        ),
      );
      const contributors = Effect.fn("Analysis.contributors")(
        (input: typeof ContributorsInput.Type) =>
          read(
            Effect.gen(function* () {
              if (
                ["cashBalanceChange", "netPrincipalReduction"].includes(input.query.measure) &&
                input.groupBy !== "account"
              )
                return yield* new FinanceError({
                  kind: "invalid",
                  message: "Account movement measures can only be grouped by account.",
                });
              const data = yield* context(input.query);
              return calculateContributors(
                data.snapshot,
                input.query,
                input.groupBy,
                {
                  current: data.period,
                  previous: yield* Effect.fromResult(
                    comparisonPeriod(input.query.period, input.query.comparison, data.period),
                  ),
                },
                data.calculatedAt,
              );
            }),
          ),
      );
      const rows = Effect.fn("Analysis.rows")((input: AnalysisRowsInput) =>
        read(
          Effect.gen(function* () {
            if (
              ["cashBalanceChange", "netPrincipalReduction"].includes(input.query.measure) &&
              input.groupBy !== "account"
            )
              return yield* new FinanceError({
                kind: "invalid",
                message: "Account movement measures can only be grouped by account.",
              });
            if (
              input.groupKey === "remainder" &&
              (input.groupBy === "tag" ||
                input.groupBy === "personalEvent" ||
                input.query.measure === "surplusRate" ||
                (input.query.measure === "purchaseCount" && input.groupBy !== "account"))
            )
              return yield* new FinanceError({
                kind: "invalid",
                message: "Overlapping groups have no remainder.",
              });
            const data = yield* context(input.query);
            return calculateRows(
              data.snapshot,
              input,
              {
                current: data.period,
                previous: yield* Effect.fromResult(
                  comparisonPeriod(input.query.period, input.query.comparison, data.period),
                ),
              },
              data.calculatedAt,
            );
          }),
        ),
      );
      return Analysis.of({ overview, compare, contributors, rows });
    }),
  );
}
