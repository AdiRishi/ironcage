import { DispatchRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import {
  AgentReadRpcs,
  AppRpcs,
  makeWorkerRequestContext,
  rpcHttpRoute,
  systemPingHandler,
} from "@ironcage/contracts/server";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { ActivityFeed } from "./activity/activity";
import { postgresActivityRepositoryLayer } from "./activity/postgres-repository";
import { MoneyBlobStore } from "./money/blob-store";
import { MoneyCryptography } from "./money/crypto";
import { MoneyImports } from "./money/importer";
import { MoneyLedger } from "./money/ledger";
import { postgresMoneyLedgerRepositoryLayer } from "./money/postgres-ledger-repository";
import { postgresMoneyImportRepositoryLayer } from "./money/postgres-repository";

const worker = "ironcage-core";
const workerRequest = makeWorkerRequestContext<Env, ExecutionContext>(
  "ironcage/core/WorkerRequest",
);
const ping = (surface: string) =>
  Effect.flatMap(workerRequest.service, () => systemPingHandler({ worker, surface }));

const appLayer = (env: Env) => {
  const dependencies = Layer.mergeAll(
    postgresActivityRepositoryLayer(env.DB.connectionString),
    postgresMoneyImportRepositoryLayer(env.DB.connectionString),
    postgresMoneyLedgerRepositoryLayer(env.DB.connectionString),
    MoneyCryptography.layer(env.MONEY_IDENTITY_KEY),
    MoneyBlobStore.layer(env.BLOBS),
  );

  return Layer.mergeAll(MoneyImports.layer, MoneyLedger.layer, ActivityFeed.layer).pipe(
    Layer.provide(dependencies),
  );
};

const withApp = <A, E>(effect: Effect.Effect<A, E, MoneyImports | MoneyLedger | ActivityFeed>) =>
  workerRequest.service.pipe(
    Effect.flatMap(({ env }) => effect.pipe(Effect.provide(appLayer(env)))),
  );

const appSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(
    AppRpcs,
    AppRpcs.toLayer({
      ping: () => ping("AppApi"),
      getFeed: (query) => withApp(Effect.flatMap(ActivityFeed, (activity) => activity.list(query))),
      getAttentionItems: () =>
        withApp(Effect.flatMap(ActivityFeed, (activity) => activity.attention)),
      acknowledgeFeedEvent: (input) =>
        withApp(Effect.flatMap(ActivityFeed, (activity) => activity.acknowledge(input))),
      registerBankAccount: ({ account, requestId }) =>
        withApp(
          Effect.flatMap(MoneyImports, (money) => money.registerAccount({ account, requestId })),
        ),
      listBankAccounts: () => withApp(Effect.flatMap(MoneyImports, (money) => money.listAccounts)),
      previewBankImport: ({ source }) =>
        withApp(Effect.flatMap(MoneyImports, (money) => money.preview(source))),
      confirmBankImport: (input) =>
        withApp(Effect.flatMap(MoneyImports, (money) => money.confirm(input))),
      archiveBankStatement: (input) =>
        withApp(Effect.flatMap(MoneyImports, (money) => money.archiveStatement(input))),
      getImportHistory: ({ accountId }) =>
        withApp(Effect.flatMap(MoneyImports, (money) => money.history(accountId))),
      getBankCoverage: ({ start, end }) =>
        withApp(
          Effect.flatMap(MoneyLedger, (money) =>
            money.coverage(start, end).pipe(Effect.map((gaps) => ({ gaps }))),
          ),
        ),
      listCategories: () => withApp(Effect.flatMap(MoneyLedger, (money) => money.listCategories)),
      createCategory: (input) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.createCategory(input))),
      renameCategory: (input) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.renameCategory(input))),
      getCategorizationReview: () =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.categorizationReview)),
      categorizeTransactions: (input) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.categorize(input))),
      getCategorizationRules: () => withApp(Effect.flatMap(MoneyLedger, (money) => money.rules)),
      editCategorizationRule: (input) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.editRule(input))),
      getTransferReview: () =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.transferReview)),
      resolveTransferMatch: (input) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.resolveTransfer(input))),
      getMoneyAnalysis: ({ startMonth, endMonth }) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.analyze(startMonth, endMonth))),
      getAccountBalances: () => withApp(Effect.flatMap(MoneyLedger, (money) => money.balances)),
      getBankTransactions: ({ ids }) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.transactions(ids))),
      generateMonthlySpendingReport: (input) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.generateReport(input))),
      listMonthlySpendingReports: () =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.listReports)),
      markMonthlySpendingReportRead: (input) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.markReportRead(input))),
      getMonthlySpendingReport: ({ id }) =>
        withApp(Effect.flatMap(MoneyLedger, (money) => money.getReport(id))),
    }),
  ),
);

const agentSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(AgentReadRpcs, AgentReadRpcs.toLayer({ ping: () => ping("AgentReadApi") })),
);

// Two entrypoints rather than two paths on one: a service binding names the
// entrypoint it targets, so the app cannot reach the agent surface and agents
// cannot reach the operator surface.
export class AppApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return appSurface.handler(request, workerRequest.forRequest(this.env, this.ctx));
  }
}

export class AgentReadApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return agentSurface.handler(request, workerRequest.forRequest(this.env, this.ctx));
  }
}

const checkBindings = (env: Env) =>
  Effect.gen(function* () {
    const dispatch = yield* clientOverBinding(DispatchRpcs, {
      binding: env.AGENTS,
      surface: "agents",
      timeout: timeouts.coreToAgents,
    });

    return {
      worker,
      AGENTS: yield* dispatch.ping(),
      COMPUTE: yield* Effect.promise(() =>
        env.COMPUTE.getByName("wiring", { locationHint: "oc" }).ping(),
      ),
      // A connection string rather than a query: what a binding proves is that
      // it resolves. Whether the database answers is the health route's job,
      // once there is a driver to ask it with.
      DB: { configured: env.DB.connectionString.length > 0 },
      DB_CACHED: { configured: env.DB_CACHED.connectionString.length > 0 },
      BLOBS: yield* Effect.promise(async () => ({
        reachable: (await env.BLOBS.head("wiring")) === null,
      })),
    };
  }).pipe(Effect.scoped);

export default class extends WorkerEntrypoint<Env> {
  override async fetch(): Promise<Response> {
    const report = await Effect.runPromise(Effect.result(checkBindings(this.env)));

    return Response.json(report, { status: report._tag === "Success" ? 200 : 503 });
  }
}
