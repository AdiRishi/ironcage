import { FinanceError } from "@repo/contracts/finance";
import type { AnalystOperation, Api } from "@repo/infra/api";
import { Schema } from "effect";
import { Toolkit } from "effect/unstable/ai";

import { Answer, answer } from "./answer.ts";
import {
  FindCounterparties,
  findCounterparties,
  ReadCounterparty,
  readCounterparty,
} from "./counterparties.ts";
import { ReadFlow, readFlow, ReadMonths, readMonths } from "./flow.ts";
import { ListQuestions, listQuestions } from "./questions.ts";
import { ReadCategories, readCategories, ReadCoverage, readCoverage } from "./records.ts";
import { ReadSpending, readSpending } from "./spending.ts";
import {
  ListTransactions,
  listTransactions,
  ReadHistory,
  readHistory,
  ReadTransaction,
  readTransaction,
} from "./transactions.ts";

// Everything the model may do: read what the screens show, and answer.
export const AnalystToolkit = Toolkit.make(
  ReadFlow,
  ReadMonths,
  ReadSpending,
  ListTransactions,
  ReadTransaction,
  ReadHistory,
  FindCounterparties,
  ReadCounterparty,
  ReadCategories,
  ReadCoverage,
  ListQuestions,
  Answer,
);

// The handlers read through the API the object binds. Each turn provides its own
// TurnEvidence, which the handlers register figures with.
export const analystTools = (api: Pick<Api, AnalystOperation>) =>
  AnalystToolkit.toLayer(
    AnalystToolkit.of({
      ReadFlow: readFlow(api),
      ReadMonths: readMonths(api),
      ReadSpending: readSpending(api),
      ListTransactions: listTransactions(api),
      ReadTransaction: readTransaction(api),
      ReadHistory: readHistory(api),
      FindCounterparties: findCounterparties(api),
      ReadCounterparty: readCounterparty(api),
      ReadCategories: readCategories(api),
      ReadCoverage: readCoverage(api),
      ListQuestions: listQuestions(api),
      Answer: answer,
    }),
  );

// A tool gives the model every failure of the API, so it can correct what it asked for.
// `unavailable` is the one no request can correct, and it ends the turn.
export const unavailableIn = (
  results: ReadonlyArray<{ readonly isFailure: boolean; readonly result: unknown }>,
) =>
  results
    .flatMap(({ isFailure, result }) =>
      isFailure && Schema.is(FinanceError)(result) && result.kind === "unavailable" ? [result] : [],
    )
    .at(0);
