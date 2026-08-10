import {
  AgentReadRpcs,
  ConversationRpcs,
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

const worker = "ironcage-agents";

const conversationSurface = HttpRouter.toWebHandler(
  RpcServer.layer(ConversationRpcs).pipe(
    Layer.provide(
      ConversationRpcs.toLayer({
        ping: () => systemPingHandler({ worker, surface: "ConversationApi" }),
      }),
    ),
    Layer.provide(rpcServerLayer),
  ),
);

const dispatchSurface = HttpRouter.toWebHandler(
  RpcServer.layer(DispatchRpcs).pipe(
    Layer.provide(
      DispatchRpcs.toLayer({ ping: () => systemPingHandler({ worker, surface: "DispatchApi" }) }),
    ),
    Layer.provide(rpcServerLayer),
  ),
);

export class ConversationApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return conversationSurface.handler(request);
  }
}

export class DispatchApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return dispatchSurface.handler(request);
  }
}

const checkBindings = (env: Env) =>
  Effect.gen(function* () {
    const core = yield* clientOverBinding(AgentReadRpcs, {
      binding: env.CORE,
      surface: "core",
      timeout: timeouts.agentsToCore,
    });

    return { worker, CORE: yield* core.ping() };
  }).pipe(Effect.scoped);

export default class extends WorkerEntrypoint<Env> {
  override async fetch(): Promise<Response> {
    const report = await Effect.runPromise(Effect.result(checkBindings(this.env)));

    return Response.json(report, { status: report._tag === "Success" ? 200 : 503 });
  }
}
