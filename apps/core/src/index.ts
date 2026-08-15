import { DispatchRpcs, clientOverBinding, timeouts } from "@ironcage/contracts/client";
import { CapabilityRunMessage } from "@ironcage/contracts/schema";
import type { ActorBinding } from "@ironcage/infra/worker-bindings";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Effect, Option, Schema } from "effect";

import { handleAgentRequest } from "./agent-api";
import { consumeCapabilityRun, consumeDeadLetter } from "./ai/consume";
import { handleAppRequest } from "./app-api";
import {
  dispatchFeedInBackground,
  drainCategorizationDispatches,
  drainFeedDispatches,
} from "./background-dispatch";
import { Postgres } from "./persistence/postgres";
import { worker } from "./runtime";

const decodeCapabilityRun = Schema.decodeUnknownOption(CapabilityRunMessage);
const decodeDeadLetter = Schema.decodeUnknownOption(Schema.Json);

class Actor extends DurableObject<Env> implements ActorBinding {
  async ping() {
    return { worker, object: this.constructor.name };
  }
}

export class SleeveActor extends Actor {}
export class VenueActor extends Actor {}
export class SystemCageActor extends Actor {}
export { FeedActor } from "./money/feed/actor";

export class AppApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/feed") {
      return this.env.FEEDS.getByName("operator").fetch(request);
    }
    return handleAppRequest(request, this.env, this.ctx);
  }
}

export class AgentReadApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return handleAgentRequest(request, this.env, this.ctx);
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
    await Effect.runPromise(
      Effect.all([drainCategorizationDispatches(this.env), drainFeedDispatches(this.env)]),
    );
  }

  override async queue(batch: MessageBatch<unknown>): Promise<void> {
    const layer = Postgres.layerForRequest(this.env.DB.connectionString);

    for (const message of batch.messages) {
      if (batch.queue.endsWith("-dlq")) {
        const body = decodeDeadLetter(message.body);
        if (Option.isNone(body)) {
          message.retry();
          continue;
        }
        const outcome = await Effect.runPromise(
          Effect.result(consumeDeadLetter(message.id, body.value).pipe(Effect.provide(layer))),
        );
        if (outcome._tag === "Failure") message.retry();
        else message.ack();
        this.ctx.waitUntil(dispatchFeedInBackground(this.env));
        continue;
      }

      const body = decodeCapabilityRun(message.body);
      if (Option.isNone(body)) {
        message.retry();
        continue;
      }
      const outcome = await Effect.runPromise(
        Effect.result(consumeCapabilityRun(body.value).pipe(Effect.provide(layer))),
      );
      if (outcome._tag === "Failure") {
        message.retry();
      } else {
        message.ack();
      }
      this.ctx.waitUntil(dispatchFeedInBackground(this.env));
    }
  }
}
