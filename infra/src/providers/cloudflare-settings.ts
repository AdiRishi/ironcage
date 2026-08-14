import type { CloudflareOpContext } from "@distilled.cloud/cloudflare";
import * as queues from "@distilled.cloud/cloudflare/queues";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DEFAULT_QUEUE_RETENTION_SECONDS } from "./types.ts";

interface CloudflareSettingsService {
  readonly getQueueRetention: (
    accountId: string,
    queueId: string,
  ) => Effect.Effect<number, unknown>;
  readonly setQueueRetention: (
    accountId: string,
    queueId: string,
    seconds: number,
  ) => Effect.Effect<void, unknown>;
}

export class CloudflareSettings extends Context.Service<
  CloudflareSettings,
  CloudflareSettingsService
>()("ironcage/infra/CloudflareSettings") {}

export const cloudflareSettingsLive = Layer.effect(
  CloudflareSettings,
  Effect.gen(function* () {
    const context = yield* Effect.context<CloudflareOpContext>();
    const provide = <A, E>(effect: Effect.Effect<A, E, CloudflareOpContext>) =>
      effect.pipe(Effect.provide(context));

    return CloudflareSettings.of({
      getQueueRetention: (accountId, queueId) =>
        provide(
          queues
            .getQueue({ accountId, queueId })
            .pipe(
              Effect.map(
                (queue) =>
                  queue.settings?.messageRetentionPeriod ?? DEFAULT_QUEUE_RETENTION_SECONDS,
              ),
            ),
        ),
      setQueueRetention: (accountId, queueId, messageRetentionPeriod) =>
        provide(
          queues
            .patchQueue({ accountId, queueId, settings: { messageRetentionPeriod } })
            .pipe(Effect.asVoid),
        ),
    });
  }),
);
