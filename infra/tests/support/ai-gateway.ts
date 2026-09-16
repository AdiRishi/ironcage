import * as Cloudflare from "alchemy/Cloudflare";
import * as Provider from "alchemy/Provider";
import { Effect, Layer } from "effect";

import { providers } from "../../src/providers.ts";

const gatewayProvider = Provider.succeed(Cloudflare.AI.Gateway, {
  reconcile: ({ id, news }) =>
    Effect.succeed({
      gatewayId: id,
      accountId: "local-test",
      cacheInvalidateOnUpdate: false,
      cacheTtl: news.cacheTtl ?? null,
      collectLogs: news.collectLogs ?? true,
      createdAt: "2026-09-01T00:00:00Z",
      modifiedAt: "2026-09-01T00:00:00Z",
      rateLimitingInterval: null,
      rateLimitingLimit: null,
      rateLimitingTechnique: "fixed",
      authentication: news.authentication ?? false,
      dlp: undefined,
      isDefault: false,
      logManagement: 100_000,
      logManagementStrategy: "STOP_INSERTING",
      logpush: false,
      logpushPublicKey: undefined,
      otel: undefined,
      storeId: "",
      stripe: undefined,
      spendLimits: undefined,
      zdr: false,
    }),
  delete: () => Effect.void,
});

export const localPlatformProviders = Layer.effect(
  Cloudflare.Providers,
  Effect.gen(function* () {
    const base = yield* Cloudflare.Providers;
    const local = yield* Provider.collection([Cloudflare.AI.Gateway]);
    return {
      ...base,
      get: (type: string) => local.get(type) ?? base.get(type),
      providers: { ...base.providers, ...local.providers },
    };
  }),
).pipe(Layer.provide(gatewayProvider), Layer.provideMerge(providers));
