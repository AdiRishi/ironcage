import { AgentReadRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import {
  ConversationRpcs,
  DispatchRpcs,
  makeWorkerRequestContext,
  rpcHttpRoute,
  systemPingHandler,
} from "@ironcage/contracts/server";
import { WorkerEntrypoint } from "cloudflare:workers";
import { Effect } from "effect";
import { HttpRouter } from "effect/unstable/http";

const worker = "ironcage-agents";
const workerRequest = makeWorkerRequestContext<Env, ExecutionContext>(
  "ironcage/agents/WorkerRequest",
);
const ping = (surface: string) =>
  Effect.flatMap(workerRequest.service, () => systemPingHandler({ worker, surface }));

const conversationSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(ConversationRpcs, ConversationRpcs.toLayer({ ping: () => ping("ConversationApi") })),
);

const dispatchSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(DispatchRpcs, DispatchRpcs.toLayer({ ping: () => ping("DispatchApi") })),
);

export class ConversationApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return conversationSurface.handler(request, workerRequest.forRequest(this.env, this.ctx));
  }
}

export class DispatchApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return dispatchSurface.handler(request, workerRequest.forRequest(this.env, this.ctx));
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
