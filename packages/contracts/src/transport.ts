import { Duration, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/unstable/rpc";

import { Internal } from "./errors";
import { rpcPath } from "./protocol";

/**
 * The slice of a Cloudflare service binding this module uses. A `Fetcher`
 * satisfies it; declaring it structurally keeps this package free of Cloudflare
 * types so it compiles once for the Worker, the browser, and the container.
 */
export interface ServiceBinding {
  readonly fetch: typeof globalThis.fetch;
}

/**
 * The origin a surface is addressed at. Nothing resolves it — a service binding
 * is not a network route — but the request still has to be built from a
 * well-formed absolute URL.
 */
export const internalOrigin = (surface: string): string => `http://${surface}.ironcage.internal`;

export const httpClientOverBinding = (
  binding: ServiceBinding,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.provide(
    FetchHttpClient.layer,
    // A `Fetcher` carries its target on `this`, so an unbound method reference
    // throws when Effect calls it.
    Layer.succeed(FetchHttpClient.Fetch)(binding.fetch.bind(binding)),
  );

/**
 * Per-call budgets, owned by engine configuration.
 *
 * Retries are absent deliberately: they differ by caller and by operation — a
 * read is not retried, a mutation only under its `request_id`, and an ambiguous
 * outcome never — so one baked in here would be wrong for most callers.
 */
export const timeouts = {
  appToCore: Duration.seconds(10),
  agentsToCore: Duration.seconds(10),
  coreToAgents: Duration.seconds(30),
  appToAgents: Duration.seconds(30),
} as const;

const withBudget = (
  client: HttpClient.HttpClient,
  timeout: Duration.Input,
): HttpClient.HttpClient =>
  HttpClient.transform(client, (effect, request) =>
    Effect.timeoutOrElse(effect, {
      duration: timeout,
      orElse: () =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({
              request,
              cause: new Error(
                `no answer within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
              ),
            }),
          }),
        ),
    }),
  );

const budgetedHttpClientOverBinding = (binding: ServiceBinding, timeout: Duration.Input) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) => withBudget(client, timeout)),
  ).pipe(Layer.provide(httpClientOverBinding(binding)));

/** A client for one RPC surface, reached over one service binding. */
export const clientOverBinding = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options: {
    readonly binding: ServiceBinding;
    readonly surface: string;
    readonly timeout: Duration.Input;
  },
) =>
  RpcClient.make(group).pipe(
    Effect.provide(
      RpcClient.layerProtocolHttp({
        url: `${internalOrigin(options.surface)}${rpcPath}`,
      }).pipe(
        Layer.provide(RpcSerialization.layerJson),
        Layer.provide(budgetedHttpClientOverBinding(options.binding, options.timeout)),
      ),
    ),
  );

/**
 * Narrow a client's failure to the error taxonomy. Every RPC call can also fail
 * with the protocol's own transport error, which no caller should have to
 * match on; folding it into `Internal` leaves only our tags.
 */
export const intoTaxonomy = <A, E, R>(
  effect: Effect.Effect<A, E | RpcClientError.RpcClientError, R>,
) =>
  Effect.catchTag(effect, "RpcClientError", (error) =>
    Effect.fail(new Internal({ detail: String(error) })),
  );
