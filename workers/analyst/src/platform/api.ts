import { FinanceError } from "@repo/contracts/finance";
import type { AnalystOperation, Api, ApiClient } from "@repo/infra/api";
import type { RpcCallError } from "alchemy/Cloudflare/Bridge";
import { Effect } from "effect";

const reached = <A>(effect: Effect.Effect<A, FinanceError | RpcCallError>) =>
  effect.pipe(
    Effect.catchTag("RpcCallError", (error) =>
      Effect.logError("The analyst could not reach the API", { method: error.method }).pipe(
        Effect.andThen(
          new FinanceError({
            kind: "unavailable",
            message: "The analyst could not reach your records. Try again in a few minutes.",
          }),
        ),
      ),
    ),
  );

// The API as the analyst reads it: a call the binding could not complete fails
// `unavailable`, like any other request that cannot reach the API, so a tool returns it
// and the turn ends with its message.
export const analystApi = (api: ApiClient<AnalystOperation>): Pick<Api, AnalystOperation> => ({
  getPeriodFlow: (input) => reached(api.getPeriodFlow(input)),
  getMonthlyFlow: (input) => reached(api.getMonthlyFlow(input)),
  getCoverage: (input) => reached(api.getCoverage(input)),
  getSpending: (input) => reached(api.getSpending(input)),
  listCountedLedger: (input) => reached(api.listCountedLedger(input)),
  listLedger: (input) => reached(api.listLedger(input)),
  getPosting: (input) => reached(api.getPosting(input)),
  getEventForPosting: (input) => reached(api.getEventForPosting(input)),
  getEventHistory: (input) => reached(api.getEventHistory(input)),
  listCounterparties: (input) => reached(api.listCounterparties(input)),
  getCounterparty: (input) => reached(api.getCounterparty(input)),
  listQuestions: (input) => reached(api.listQuestions(input)),
  summarizeQuestions: (input) => reached(api.summarizeQuestions(input)),
  getReferenceData: () => reached(api.getReferenceData()),
  listAccounts: () => reached(api.listAccounts()),
  listImports: (input) => reached(api.listImports(input)),
  getSettings: () => reached(api.getSettings()),
  getFactsStatus: () => reached(api.getFactsStatus()),
  previewCorrection: (input) => reached(api.previewCorrection(input)),
  previewCounterpartyChange: (input) => reached(api.previewCounterpartyChange(input)),
  getModelAllowance: (input) => reached(api.getModelAllowance(input)),
  recordModelUsage: (input) => reached(api.recordModelUsage(input)),
});
