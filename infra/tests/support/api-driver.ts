import {
  RemoveSourceBytes,
  RequestExport,
  ExportInput,
  CreateAccount,
  ListPostings,
  PostingInput,
  PostingPage,
  PostingDetail,
  ModelUsage,
} from "@repo/contracts/finance";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Schema } from "effect";
import {
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

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
    const fetchApi = yield* Cloudflare.Workers.Fetch(yield* Api);
    const routes = Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/model-usage",
        Effect.gen(function* () {
          return HttpServerResponse.jsonUnsafe(
            yield* Schema.encodeEffect(ModelUsage)(yield* api.getModelUsage()),
          );
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "*",
        "/http/*",
        Effect.gen(function* () {
          const incoming = yield* HttpServerRequest.HttpServerRequest;
          const request = HttpClientRequest.fromWeb(yield* HttpServerRequest.toWeb(incoming));
          const response = yield* fetchApi(
            HttpClientRequest.setUrl(request, `http://api${incoming.url.slice(5)}`),
          );
          return HttpServerResponse.stream(response.stream, {
            status: response.status,
            headers: response.headers,
          });
        }).pipe(Effect.orDie),
      ),
      HttpRouter.add(
        "GET",
        "/source-files",
        api.listSourceFiles().pipe(Effect.map(HttpServerResponse.jsonUnsafe), Effect.orDie),
      ),
      HttpRouter.add(
        "POST",
        "/remove-source",
        Effect.gen(function* () {
          const input = yield* HttpServerRequest.schemaBodyJson(RemoveSourceBytes);
          return HttpServerResponse.jsonUnsafe(yield* api.removeSourceBytes(input));
        }).pipe(
          Effect.catchTag("FinanceError", (error) =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe(
                { kind: error.kind, message: error.message },
                { status: 409 },
              ),
            ),
          ),
          Effect.orDie,
        ),
      ),
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
  }).pipe(Effect.provide(Cloudflare.Workers.FetchBinding)),
) {}
