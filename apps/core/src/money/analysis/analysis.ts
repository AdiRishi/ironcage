import type { MoneyAnalysis } from "@ironcage/contracts/schema";
import { Effect } from "effect";

import { persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";
import { loadCoverageSummary } from "../accounts";
import { computeAnomalies } from "./anomalies";
import { computeMonths } from "./months";
import { computeRecurring } from "./recurring";
import { loadSplitLines } from "./split-lines";
import { computeSuggestions, type SuggestionResult } from "./suggestions";

export const analyzeMoney = Effect.fn("analyzeMoney")(function* (sql: SqlExecutor) {
  const coverage = yield* loadCoverageSummary(sql);
  const lines = yield* loadSplitLines(sql);
  const complete = new Set(coverage.completeMonths);
  const months = computeMonths(lines, complete);
  const recurring =
    coverage.dataThrough === null ? [] : computeRecurring(lines, coverage.dataThrough);
  const anomalies = computeAnomalies(lines, months, complete);
  const { suggestions, unavailable }: SuggestionResult =
    coverage.dataThrough === null
      ? { suggestions: [], unavailable: "no covered history yet" }
      : computeSuggestions(recurring, complete, coverage.dataThrough);

  return {
    months,
    recurring: recurring.map(({ transactionIds: _, ...group }) => group),
    anomalies,
    suggestions,
    suggestionsUnavailable: unavailable,
    completeMonths: coverage.completeMonths,
    dataThrough: coverage.dataThrough,
  } satisfies MoneyAnalysis;
});

export const getMoneyAnalysis = Effect.fn("getMoneyAnalysis")(function* () {
  const postgres = yield* Postgres;
  return yield* postgres.readTransaction(analyzeMoney);
}, persistenceToBoundary);
