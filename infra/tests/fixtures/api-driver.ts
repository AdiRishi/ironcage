import {
  RequestExport,
  ExportInput,
  CreateAccount,
  ListPostings,
  PostingInput,
  PostingPage,
  PostingDetail,
} from "@repo/contracts/finance";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { Api } from "../../src/api.ts";
import { workerCompatibility } from "../../src/cloudflare-config.ts";
export default class ApiDriver extends Cloudflare.Worker<ApiDriver>()(
  "ApiDriver",
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: true,
  },
  Effect.gen(function* () {
    const api = yield* Cloudflare.Workers.bindWorker(Api);
    const routes = Layer.mergeAll(
      HttpRouter.add(
        "POST",
        "/exports",
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(RequestExport);
          return HttpServerResponse.jsonUnsafe(yield* api.requestExport(input));
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "GET",
        "/exports/:exportId",
        Effect.gen(function* () {
          const input = yield* HttpRouter.schemaPathParams(ExportInput);
          return HttpServerResponse.jsonUnsafe(yield* api.getExport(input));
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "GET",
        "/",
        Effect.gen(function* () {
          return HttpServerResponse.jsonUnsafe(yield* api.listAccounts());
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "POST",
        "/accounts",
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(CreateAccount);
          return HttpServerResponse.jsonUnsafe(yield* api.createAccount(input));
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "GET",
        "/imports",
        Effect.gen(function* () {
          return HttpServerResponse.jsonUnsafe(yield* api.listImports());
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "POST",
        "/transactions",
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(ListPostings);
          const result = yield* api.listPostings(input);
          return HttpServerResponse.jsonUnsafe(yield* Schema.encodeEffect(PostingPage)(result));
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "POST",
        "/transaction",
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(PostingInput);
          return HttpServerResponse.jsonUnsafe(
            yield* Schema.encodeEffect(PostingDetail)(yield* api.getPosting(input)),
          );
        }).pipe(Effect.orDie),
      ),
    );
    return { fetch: yield* HttpRouter.toHttpEffect(routes) };
  }),
) {}
