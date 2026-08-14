import { AgentReadRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import { Internal } from "@ironcage/contracts/schema";
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

import { runCategorization } from "./categorization";

const worker = "ironcage-agents";
const workerRequest = makeWorkerRequestContext<Env, ExecutionContext>(
  "ironcage/agents/WorkerRequest",
);
const ping = (surface: string) =>
  Effect.flatMap(workerRequest.service, () => systemPingHandler({ worker, surface }));

const conversationSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(ConversationRpcs, ConversationRpcs.toLayer({ ping: () => ping("ConversationApi") })),
);

/** The pinned model behind the categorization capability's configuration. */
const categorizationModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const dispatchSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(
    DispatchRpcs,
    DispatchRpcs.toLayer({
      ping: () => ping("DispatchApi"),
      dispatchCategorization: (payload) =>
        Effect.flatMap(workerRequest.service, ({ env }) =>
          Effect.tryPromise({
            try: () =>
              runCategorization(payload, {
                model: categorizationModel,
                infer: async (prompt) => {
                  const answer = await env.AI_GATEWAY.run(categorizationModel, {
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 4096,
                  });
                  return typeof answer === "object" && answer !== null && "response" in answer
                    ? String((answer as { response: unknown }).response)
                    : JSON.stringify(answer);
                },
                send: (message) => env.DECISION_RECORDS.send(message),
              }),
            catch: (cause) =>
              new Internal({
                detail: cause instanceof Error ? cause.message : "categorization dispatch failed",
              }),
          }),
        ),
    }),
  ),
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
