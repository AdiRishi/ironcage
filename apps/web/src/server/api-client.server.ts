import type { Api } from "@repo/infra/api";
import { getRequest } from "@tanstack/react-start/server";
import { makeRpcStub, type RpcCallError } from "alchemy/Cloudflare/Bridge";
import { env } from "cloudflare:workers";
import { Effect } from "effect";

import { runApiRequest } from "./api-request";

type ApiMethods = Pick<
  Api,
  | "saveAnalysis"
  | "getAnalysis"
  | "listAnalyses"
  | "renameAnalysis"
  | "deleteAnalysis"
  | "overview"
  | "compare"
  | "contributors"
  | "rows"
  | "getEventRelationships"
  | "listRelationshipCandidates"
  | "previewRelationship"
  | "applyRelationship"
  | "listInterpretationReviews"
  | "proposeRelationships"
  | "dismissInterpretationReview"
  | "listAccountPeriods"
  | "saveAccountPeriod"
  | "deleteAccountPeriod"
  | "listRules"
  | "getRuleExceptions"
  | "previewRule"
  | "saveRule"
  | "deleteRule"
  | "reinterpretPostings"
  | "listCounterparties"
  | "getCounterparty"
  | "saveCounterparty"
  | "mergeCounterparties"
  | "moveAlias"
  | "assignEventCounterparty"
  | "listQuestions"
  | "getPeriodFlow"
  | "getMonthlyFlow"
  | "getSpending"
  | "getEnrichmentSettings"
  | "updateEnrichmentSettings"
  | "requestEnrichment"
  | "listEnrichmentRuns"
  | "listCategoryProposals"
  | "previewCorrection"
  | "applyCorrection"
  | "undoCorrection"
  | "getCorrectionHistory"
  | "saveReference"
  | "deleteReference"
  | "getEvent"
  | "getEventForPosting"
  | "getInterpretationSummary"
  | "getReferenceData"
  | "listSourceFiles"
  | "removeSourceBytes"
  | "getModelUsage"
  | "listExports"
  | "requestExport"
  | "listReviewItems"
  | "resolveReview"
  | "listAccounts"
  | "createAccount"
  | "updateAccount"
  | "listPostings"
  | "getPosting"
  | "listImports"
  | "getImport"
  | "retryImport"
  | "getSettings"
  | "getRetention"
  | "updateSettings"
>;

// The remote Worker supplies RuntimeContext; only results and failures cross the binding.
type ApiClient = {
  [K in keyof ApiMethods]: (
    ...args: Parameters<ApiMethods[K]>
  ) => Effect.Effect<
    Effect.Success<ReturnType<ApiMethods[K]>>,
    Effect.Error<ReturnType<ApiMethods[K]>> | RpcCallError
  >;
};

const apiOrigin = "https://api.internal";

export const fetchApi = (path: string, init?: RequestInit) =>
  env.API.fetch(new Request(new URL(path, apiOrigin), init));

export const callApiRpc = <A, E>(use: (client: ApiClient) => Effect.Effect<A, E>): Promise<A> =>
  runApiRequest(
    Effect.suspend(() => use(makeRpcStub<ApiClient>(env.API))).pipe(Effect.timeout("10 seconds")),
    getRequest().signal,
  );
