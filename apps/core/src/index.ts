import {
  AgentReadRpcs,
  AppRpcs,
  DispatchRpcs,
  clientOverBinding,
  rpcServerLayer,
  systemPingHandler,
  timeouts,
} from "@ironcage/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcServer } from "effect/unstable/rpc";

const worker = "ironcage-core";

const appSurface = HttpRouter.toWebHandler(
  RpcServer.layer(AppRpcs).pipe(
    Layer.provide(
      AppRpcs.toLayer({ ping: () => systemPingHandler({ worker, surface: "AppApi" }) }),
    ),
    Layer.provide(rpcServerLayer),
  ),
);

const agentSurface = HttpRouter.toWebHandler(
  RpcServer.layer(AgentReadRpcs).pipe(
    Layer.provide(
      AgentReadRpcs.toLayer({ ping: () => systemPingHandler({ worker, surface: "AgentReadApi" }) }),
    ),
    Layer.provide(rpcServerLayer),
  ),
);

// Two entrypoints rather than two paths on one: a service binding names the
// entrypoint it targets, so the app cannot reach the agent surface and agents
// cannot reach the operator surface.
export class AppApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return appSurface.handler(request);
  }
}

export class AgentReadApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return agentSurface.handler(request);
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
      COMPUTE: yield* Effect.promise(() => env.COMPUTE.getByName("wiring").ping()),
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
