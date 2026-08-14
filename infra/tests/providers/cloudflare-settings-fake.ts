import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { CloudflareSettings } from "../../src/providers/cloudflare-settings.ts";
import { cloudflareSettingsProviders } from "../../src/providers/index.ts";
import { DEFAULT_QUEUE_RETENTION_SECONDS } from "../../src/providers/types.ts";

const accountId = "00000000000000000000000000000000";

export const queueRetention = new Map<string, number>();

const settings = CloudflareSettings.of({
  getQueueRetention: (_accountId, queueId) =>
    Effect.succeed(queueRetention.get(queueId) ?? DEFAULT_QUEUE_RETENTION_SECONDS),
  setQueueRetention: (_accountId, queueId, seconds) =>
    Effect.sync(() => queueRetention.set(queueId, seconds)).pipe(Effect.asVoid),
});

const providers = cloudflareSettingsProviders().pipe(
  Layer.provideMerge(Layer.succeed(CloudflareSettings, settings)),
  Layer.provideMerge(
    Layer.succeed(
      Cloudflare.CloudflareEnvironment,
      Effect.succeed({
        type: "apiToken" as const,
        apiToken: Redacted.make("test-token"),
        accountId,
        source: { type: "env" as const },
      }),
    ),
  ),
);

const api = Test.make({ providers });

api.beforeEach(
  Effect.sync(() => {
    queueRetention.clear();
  }),
);

export const test = api.test.provider;
