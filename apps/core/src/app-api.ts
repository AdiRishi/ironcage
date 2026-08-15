import { AppRpcs, rpcHttpRoute } from "@ironcage/contracts/server";
import type { Sha256 } from "@ironcage/domain";
import { Effect } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { scheduleDispatch } from "./background-dispatch";
import {
  configureBankAccount,
  getBankAccounts,
  getBankCoverage,
  getImportHistory,
} from "./money/accounts";
import { getMoneyAnalysis } from "./money/analysis";
import {
  categorizeTransactions,
  createCategory,
  editCategorizationRule,
  editCategory,
  getCategorizationRules,
  listCategories,
  listTransactions,
} from "./money/categorization";
import { acknowledge, getFeed } from "./money/feed";
import { confirmBankImport, previewBankImport, type ImportDeps } from "./money/import";
import { decideTransferMatch, getTransferMatches } from "./money/transfers";
import { getWholeWealth, listExternalAccounts, recordExternalBalance } from "./money/wealth";
import { Postgres } from "./persistence/postgres";
import { getReport, listReports, markReportOpened } from "./reports";
import { payloadHash, ping, runCoreRequest, workerRequest } from "./runtime";
import { getSystemStatus, haltAll } from "./system";

const importDependencies = (env: Env): ImportDeps => ({
  identityKey: env.MONEY_IDENTITY_KEY,
  extractStatement: (pdf) => env.STATEMENT_EXTRACTION.getByName("statement-extractor").extract(pdf),
});

const idempotently = <P extends { readonly requestId: unknown }, A, E>(
  payload: P,
  handler: (input: P & { readonly payloadHash: Sha256 }) => Effect.Effect<A, E, Postgres>,
) =>
  Effect.gen(function* () {
    const { requestId: _, ...content } = payload;
    const hash = yield* payloadHash(content);
    return yield* runCoreRequest(() => handler({ ...payload, payloadHash: hash })).pipe(
      Effect.tap(() => scheduleDispatch()),
    );
  });

const appSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(
    AppRpcs,
    AppRpcs.toLayer({
      ping: () => ping("AppApi"),
      getSystemStatus: () => runCoreRequest(() => getSystemStatus()),
      haltAll: (payload) => idempotently(payload, haltAll),
      previewBankImport: ({ source }) =>
        runCoreRequest((env) => previewBankImport(source, importDependencies(env))),
      confirmBankImport: (payload) =>
        runCoreRequest((env) => confirmBankImport(payload, importDependencies(env))).pipe(
          Effect.tap((result) =>
            result.kind === "confirmed" ? scheduleDispatch(true) : Effect.void,
          ),
        ),
      getBankAccounts: () => runCoreRequest(() => getBankAccounts()),
      getBankCoverage: () => runCoreRequest(() => getBankCoverage()),
      getImportHistory: () => runCoreRequest(() => getImportHistory()),
      configureBankAccount: (payload) => idempotently(payload, configureBankAccount),
      listCategories: () => runCoreRequest(() => listCategories()),
      createCategory: (payload) => idempotently(payload, createCategory),
      editCategory: (payload) => idempotently(payload, editCategory),
      getCategorizationRules: () => runCoreRequest(() => getCategorizationRules()),
      editCategorizationRule: (payload) => idempotently(payload, editCategorizationRule),
      categorizeTransactions: (payload) => idempotently(payload, categorizeTransactions),
      listTransactions: (payload) => runCoreRequest(() => listTransactions(payload.scope)),
      getTransferMatches: () => runCoreRequest(() => getTransferMatches()),
      decideTransferMatch: (payload) => idempotently(payload, decideTransferMatch),
      getMoneyAnalysis: () => runCoreRequest(() => getMoneyAnalysis()),
      getFeed: (payload) => runCoreRequest(() => getFeed(payload)),
      acknowledge: (payload) => idempotently(payload, acknowledge),
      getWholeWealth: () => runCoreRequest(() => getWholeWealth()),
      listExternalAccounts: () => runCoreRequest(() => listExternalAccounts()),
      recordExternalBalance: (payload) => idempotently(payload, recordExternalBalance),
      listReports: () => runCoreRequest(() => listReports()),
      getReport: ({ reportId }) => runCoreRequest(() => getReport(reportId)),
      markReportOpened: (payload) => idempotently(payload, markReportOpened),
    }),
  ),
);

export const handleAppRequest = (request: Request, env: Env, executionContext: ExecutionContext) =>
  appSurface.handler(request, workerRequest.forRequest(env, executionContext));
