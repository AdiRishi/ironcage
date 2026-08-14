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
import { Effect, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { sha256Hex } from "./money/bytes";
import { confirmBankImport, previewBankImport, type ImportDeps } from "./money/import";
import {
  configureBankAccount,
  getBankAccounts,
  getBankCoverage,
  getImportHistory,
} from "./money/queries";
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
    }).pipe(
      Effect.provide(Postgres.layerForRequest(env.DB.connectionString)),
      persistenceToBoundary,
    ),
  );

const payloadHash = (value: unknown) =>
  Effect.promise(() => sha256Hex(new TextEncoder().encode(JSON.stringify(value)))).pipe(
    Effect.map(decodeSha),
  );

const appSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(
    AppRpcs,
    AppRpcs.toLayer({
      ping: () => ping("AppApi"),
      previewBankImport: ({ source }) => withMoney((deps) => previewBankImport(source, deps)),
      confirmBankImport: (payload) => withMoney((deps) => confirmBankImport(payload, deps)),
      getBankAccounts: () => withMoney(() => getBankAccounts()),
      getBankCoverage: () => withMoney(() => getBankCoverage()),
      getImportHistory: () => withMoney(() => getImportHistory()),
      configureBankAccount: (payload) =>
        Effect.gen(function* () {
          const hash = yield* payloadHash({
            productLabel: payload.productLabel,
            accountType: payload.accountType,
            required: payload.required,
            openedOn: payload.openedOn,
            closedOn: payload.closedOn,
          });
          return yield* withMoney(() => configureBankAccount({ ...payload, payloadHash: hash }));
        }),
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
}
