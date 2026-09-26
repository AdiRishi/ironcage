import { FinanceError } from "@repo/contracts/finance";
import type { AnalystOperation, Api } from "@repo/infra/api";
import { Effect, Schema, Stream } from "effect";
import { type Prompt, type Tool, Toolkit } from "effect/unstable/ai";

import { Answer, answer } from "./answer.ts";
import {
  FindCounterparties,
  findCounterparties,
  ReadCounterparty,
  readCounterparty,
} from "./counterparties.ts";
import { ReadFlow, readFlow, ReadMonths, readMonths } from "./flow.ts";
import {
  ProposeCounterpartyDefault,
  proposeCounterpartyDefault,
  ProposeReferenceDefault,
  proposeReferenceDefault,
  ProposeTransactionChange,
  proposeTransactionChange,
} from "./proposals.ts";
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

// Everything the model may do: read what the screens show, propose changes that wait for
// you to accept them, and answer.
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
  ProposeTransactionChange,
  ProposeCounterpartyDefault,
  ProposeReferenceDefault,
  Answer,
);

export type AnalystTools = typeof AnalystToolkit.tools;

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
      ProposeTransactionChange: proposeTransactionChange(api),
      ProposeCounterpartyDefault: proposeCounterpartyDefault(api),
      ProposeReferenceDefault: proposeReferenceDefault(api),
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

// Runs a read the model did not ask for as if it had: the result, and the call and the
// result as they go in the model's prompt.
export const readAs = <Name extends keyof AnalystTools>(
  toolkit: Effect.Success<typeof AnalystToolkit>,
  name: Name,
  params: Tool.ParametersEncoded<AnalystTools[Name]>,
  callId: string,
) =>
  toolkit.handle(name, params, callId).pipe(
    Effect.flatMap(Stream.runLast),
    Effect.flatMap(Effect.fromOption),
    // The toolkit has every tool named here, and each handler ends with one result.
    Effect.orDie,
    Effect.map((result) => ({
      result,
      messages: [
        { role: "assistant", content: [{ type: "tool-call", id: callId, name, params }] },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              id: callId,
              name,
              isFailure: result.isFailure,
              result: result.encodedResult,
            },
          ],
        },
      ] satisfies ReadonlyArray<Prompt.MessageEncoded>,
    })),
  );
