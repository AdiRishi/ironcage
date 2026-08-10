import { Duration, Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/unstable/http";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

import { Internal } from "./errors";
import { rpcPath } from "./serve";

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

const withBudget =
  (timeout: Duration.Input) =>
  <E, R>(client: HttpClient.HttpClient.With<E, R>): HttpClient.HttpClient.With<E, R> =>
    HttpClient.transform(client, (effect, request) =>
      Effect.timeoutOrElse(effect, {
        duration: timeout,
        // Failing as a transport error is what keeps the client's error type
        // intact; a domain error here would widen every procedure's signature.
        orElse: () =>
          Effect.fail(
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({
                request,
                cause: new Error(
                  `no answer within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
                ),
              }),
            }) as unknown as E,
          ),
      }),
    );

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
        transformClient: withBudget(options.timeout),
      }).pipe(
        Layer.provide(RpcSerialization.layerJson),
        Layer.provide(httpClientOverBinding(options.binding)),
      ),
    ),
  );

const isTransportFailure = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { _tag?: string })._tag === "RpcClientError";

/**
 * Narrow a client's failure to the error taxonomy. Every RPC call can also fail
 * with the protocol's own transport error, which no caller should have to
 * match on; folding it into `Internal` leaves only our tags.
 */
export const intoTaxonomy = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.catch(
    effect,
    (error): Effect.Effect<never, Internal | Exclude<E, { readonly _tag: "RpcClientError" }>> =>
      Effect.fail(
        isTransportFailure(error)
          ? new Internal({ detail: String(error) })
          : (error as Exclude<E, { readonly _tag: "RpcClientError" }>),
      ),
  );
