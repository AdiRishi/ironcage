import { Ask, ConversationInput } from "@repo/contracts/analyst";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { Analyst } from "../../src/analyst.ts";
import { workerCompatibility } from "../../src/cloudflare-config.ts";

export default class AnalystDriver extends Cloudflare.Worker<AnalystDriver>()(
  "AnalystDriver",
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: true,
  },
  Effect.gen(function* () {
    const analyst = yield* Cloudflare.Workers.bindWorker(Analyst);
    const routes = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/",
        Effect.gen(function* () {
          return HttpServerResponse.jsonUnsafe(yield* analyst.listConversations({}));
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "POST",
        "/ask",
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(Ask);
          return HttpServerResponse.jsonUnsafe(yield* analyst.ask(input));
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "GET",
        "/conversations/:conversationId",
        Effect.gen(function* () {
          const input = yield* HttpRouter.schemaPathParams(ConversationInput);
          return HttpServerResponse.jsonUnsafe(yield* analyst.getConversation(input));
        }).pipe(Effect.orDie),
      ),
    );
    return { fetch: yield* HttpRouter.toHttpEffect(routes) };
  }),
) {}
