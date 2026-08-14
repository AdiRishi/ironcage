import { DispatchRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import { CategorizationBatchItem, categorizationCapability } from "@ironcage/contracts/schema";
import {
  AgentReadRpcs,
  AppRpcs,
  makeWorkerRequestContext,
  rpcHttpRoute,
  systemPingHandler,
} from "@ironcage/contracts/server";
import { deriveRunId, Sha256 } from "@ironcage/domain";
import type { ActorBinding } from "@ironcage/infra/worker-bindings";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { consumeCapabilityRun, consumeDeadLetter, loadCategorizationBatches } from "./ai/consume";
import { getMoneyAnalysis } from "./money/analysis";
import { sha256Hex } from "./money/bytes";
import {
  categorizeTransactions,
  createCategory,
  editCategorizationRule,
  editCategory,
  getCategorizationRules,
  getReviewQueue,
  listCategories,
  listCategoryRows,
} from "./money/categorize";
import { acknowledge, getFeed } from "./money/feed";
import { confirmBankImport, previewBankImport, type ImportDeps } from "./money/import";
import {
  configureBankAccount,
  getBankAccounts,
  getBankCoverage,
  getImportHistory,
} from "./money/queries";
import { decideTransferMatch, getTransferMatches } from "./money/transfers";
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

const decodeBatchItem = Schema.decodeUnknownSync(CategorizationBatchItem);

/**
 * Dispatches the confirmed import's uncategorized rows to the categorization
 * capability, one deterministically-identified run per batch. A duplicate
 * dispatch re-derives the same run IDs, so the consumer's dedupe boundary
 * absorbs any repeat.
 */
const dispatchCategorizationRuns = (bundleDigest: Sha256) =>
  Effect.flatMap(workerRequest.service, ({ env }) =>
    Effect.gen(function* () {
      const postgres = yield* Postgres;
      const batches = yield* postgres.readTransaction((sql) =>
        loadCategorizationBatches(sql, bundleDigest),
      );
      if (batches.length === 0) return;

      const categories = yield* postgres.readTransaction((sql) => listCategoryRows(sql));
      const offered = categories
        .filter((category) => !category.system && !category.archived)
        .map((category) => ({ id: category.id, name: category.name, kind: category.kind }));

      const dispatch = yield* clientOverBinding(DispatchRpcs, {
        binding: env.AGENTS,
        surface: "agents",
        timeout: timeouts.coreToAgents,
      });

      for (const [batchIndex, { batch }] of batches.entries()) {
        const runId = yield* Effect.promise(() =>
          deriveRunId(
            categorizationCapability.name,
            categorizationCapability.configVersion,
            `${bundleDigest}|${batchIndex}`,
          ),
        );
        yield* dispatch.dispatchCategorization({
          runId,
          configVersion: categorizationCapability.configVersion,
          bundleDigest,
          batchIndex,
          batch: batch.map((item) => decodeBatchItem(item)),
          categories: offered,
        });
      }
    }).pipe(Effect.provide(Postgres.layerForRequest(env.DB.connectionString)), Effect.scoped),
  );

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
              ? dispatchCategorizationRuns(payload.expectedBundleDigest).pipe(
                  // A failed dispatch is a missed run, not a failed import.
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
      getReviewQueue: () => withMoney(() => getReviewQueue()),
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

  /**
   * The decision-records consumer (batch size one) and its dead-letter
   * sibling. An undecodable or unpersistable delivery retries toward the DLQ;
   * everything else acknowledges after its one transaction commits.
   */
  override async queue(batch: MessageBatch<unknown>): Promise<void> {
    const layer = Postgres.layerForRequest(this.env.DB.connectionString);

    for (const message of batch.messages) {
      if (batch.queue.endsWith("-dlq")) {
        await Effect.runPromise(
          consumeDeadLetter(message.id, message.body).pipe(
            Effect.provide(layer),
            Effect.catchCause(() => Effect.void),
          ),
        );
        message.ack();
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
