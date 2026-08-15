import { DispatchRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import {
  AgentReadRpcs,
  AppRpcs,
  makeWorkerRequestContext,
  rpcHttpRoute,
  systemPingHandler,
} from "@ironcage/contracts/server";
import { Sha256 } from "@ironcage/domain";
import type { ActorBinding } from "@ironcage/infra/worker-bindings";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Cause, Effect, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { consumeCapabilityRun, consumeDeadLetter } from "./ai/consume";
import {
  getBankAccounts,
  getBankCoverage,
  getImportHistory,
  configureBankAccount,
} from "./money/accounts/service";
import { getMoneyAnalysis } from "./money/analysis/service";
import {
  listPendingCategorizationDispatches,
  markCategorizationDispatched,
  recordCategorizationDispatchFailure,
} from "./money/categorization/dispatch";
import {
  categorizeTransactions,
  createCategory,
  editCategorizationRule,
  editCategory,
  getCategorizationRules,
  listTransactions,
  listCategories,
} from "./money/categorization/service";
import { acknowledge, getFeed } from "./money/feed/service";
import { sha256Hex } from "./money/import/bytes";
import { confirmBankImport, previewBankImport, type ImportDeps } from "./money/import/service";
import { decideTransferMatch, getTransferMatches } from "./money/transfers/service";
import { persistenceToBoundary } from "./persistence/error";
import { Postgres } from "./persistence/postgres";

const worker = "ironcage-core";
const workerRequest = makeWorkerRequestContext<Env, ExecutionContext>(
  "ironcage/core/WorkerRequest",
);
const ping = (surface: string) =>
  Effect.flatMap(workerRequest.service, () => systemPingHandler({ worker, surface }));

const decodeSha = Schema.decodeUnknownSync(Sha256);

/**
 * Every Money handler runs against the uncached Hyperdrive binding with one
 * connection scoped to the request; the import dependencies carry the
 * identity key and the R2 artifact writer.
 */
const withMoney = <A, E>(use: (deps: ImportDeps) => Effect.Effect<A, E, Postgres>) =>
  Effect.flatMap(workerRequest.service, ({ env }) =>
    use({
      identityKey: env.MONEY_IDENTITY_KEY,
      artifacts: { put: (key, bytes) => env.BLOBS.put(key, bytes) },
      extractStatement: (pdf) =>
        env.STATEMENT_EXTRACTION.getByName("statement-extractor").extract(pdf),
    }).pipe(
      Effect.provide(Postgres.layerForRequest(env.DB.connectionString)),
      persistenceToBoundary,
    ),
  );

const payloadHash = (value: unknown) =>
  Effect.promise(() => sha256Hex(new TextEncoder().encode(JSON.stringify(value)))).pipe(
    Effect.map(decodeSha),
  );

const drainCategorizationDispatches = (env: Env) =>
  Effect.gen(function* () {
    const postgres = yield* Postgres;
    const pending = yield* postgres.readTransaction((sql) =>
      listPendingCategorizationDispatches(sql, 50),
    );
    if (pending.length === 0) return 0;

    const dispatch = yield* clientOverBinding(DispatchRpcs, {
      binding: env.AGENTS,
      surface: "agents",
      timeout: timeouts.coreToAgents,
    });

    let dispatched = 0;
    for (const item of pending) {
      const sent = yield* dispatch.dispatchCategorization(item).pipe(
        Effect.matchCauseEffect({
          onFailure: (cause) =>
            postgres
              .transaction((sql) =>
                recordCategorizationDispatchFailure(sql, item.runId, Cause.pretty(cause)),
              )
              .pipe(Effect.as(false)),
          onSuccess: () =>
            postgres
              .transaction((sql) => markCategorizationDispatched(sql, item.runId))
              .pipe(Effect.as(true)),
        }),
      );
      if (sent) dispatched += 1;
    }
    return dispatched;
  }).pipe(Effect.provide(Postgres.layerForRequest(env.DB.connectionString)), Effect.scoped);

/**
 * Wraps a mutation handler with the app request-id idempotency contract: the
 * payload (minus the request ID itself) is hashed so a replayed request with
 * different content raises `Conflict` instead of silently absorbing.
 */
const idempotently = <P extends { readonly requestId: unknown }, A, E>(
  payload: P,
  handler: (input: P & { readonly payloadHash: Sha256 }) => Effect.Effect<A, E, Postgres>,
) =>
  Effect.gen(function* () {
    const { requestId: _, ...content } = payload;
    const hash = yield* payloadHash(content);
    return yield* withMoney(() => handler({ ...payload, payloadHash: hash }));
  });

const appSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(
    AppRpcs,
    AppRpcs.toLayer({
      ping: () => ping("AppApi"),
      previewBankImport: ({ source }) => withMoney((deps) => previewBankImport(source, deps)),
      confirmBankImport: (payload) =>
        withMoney((deps) => confirmBankImport(payload, deps)).pipe(
          Effect.tap((result) =>
            result.kind === "confirmed"
              ? Effect.flatMap(workerRequest.service, ({ env }) =>
                  drainCategorizationDispatches(env),
                ).pipe(
                  Effect.catchCause((cause) =>
                    Effect.logWarning("categorization dispatch failed", cause),
                  ),
                )
              : Effect.void,
          ),
        ),
      getBankAccounts: () => withMoney(() => getBankAccounts()),
      getBankCoverage: () => withMoney(() => getBankCoverage()),
      getImportHistory: () => withMoney(() => getImportHistory()),
      configureBankAccount: (payload) => idempotently(payload, configureBankAccount),
      listCategories: () => withMoney(() => listCategories()),
      createCategory: (payload) => idempotently(payload, createCategory),
      editCategory: (payload) => idempotently(payload, editCategory),
      getCategorizationRules: () => withMoney(() => getCategorizationRules()),
      editCategorizationRule: (payload) => idempotently(payload, editCategorizationRule),
      categorizeTransactions: (payload) => idempotently(payload, categorizeTransactions),
      listTransactions: (payload) => withMoney(() => listTransactions(payload.scope)),
      getTransferMatches: () => withMoney(() => getTransferMatches()),
      decideTransferMatch: (payload) => idempotently(payload, decideTransferMatch),
      getMoneyAnalysis: () => withMoney(() => getMoneyAnalysis()),
      getFeed: (payload) => withMoney(() => getFeed(payload)),
      acknowledge: (payload) => idempotently(payload, acknowledge),
    }),
  ),
);

const agentSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(AgentReadRpcs, AgentReadRpcs.toLayer({ ping: () => ping("AgentReadApi") })),
);

class Actor extends DurableObject<Env> implements ActorBinding {
  async ping() {
    return { worker, object: this.constructor.name };
  }
}

export class SleeveActor extends Actor {}
export class VenueActor extends Actor {}
export class SystemCageActor extends Actor {}
export class FeedActor extends Actor {}

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

  override async scheduled(): Promise<void> {
    await Effect.runPromise(drainCategorizationDispatches(this.env));
  }

  /**
   * The decision-records consumer (batch size one) and its dead-letter
   * sibling. An undecodable or unpersistable delivery retries toward the DLQ;
   * everything else acknowledges after its one transaction commits.
   */
  override async queue(batch: MessageBatch<unknown>): Promise<void> {
    const layer = Postgres.layerForRequest(this.env.DB.connectionString);

    for (const message of batch.messages) {
      if (batch.queue.endsWith("-dlq")) {
        const outcome = await Effect.runPromise(
          Effect.result(consumeDeadLetter(message.id, message.body).pipe(Effect.provide(layer))),
        );
        if (outcome._tag === "Failure") message.retry();
        else message.ack();
        continue;
      }

      const outcome = await Effect.runPromise(
        Effect.result(consumeCapabilityRun(message.body).pipe(Effect.provide(layer))),
      );
      if (outcome._tag === "Failure" || outcome.success.kind === "undecodable") {
        message.retry();
      } else {
        message.ack();
      }
    }
  }
}
