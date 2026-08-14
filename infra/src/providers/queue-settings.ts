import * as Cloudflare from "alchemy/Cloudflare";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as AlchemyResource } from "alchemy/Resource";
import * as Effect from "effect/Effect";

import { CloudflareSettings } from "./cloudflare-settings.ts";
import {
  DEFAULT_QUEUE_RETENTION_SECONDS,
  type QueueSettingsAttributes,
  type QueueSettingsProps,
} from "./types.ts";

type QueueSettings = AlchemyResource<
  "Ironcage.Cloudflare.QueueSettings",
  QueueSettingsProps,
  QueueSettingsAttributes
>;

export const QueueSettings = Resource<QueueSettings>("Ironcage.Cloudflare.QueueSettings");

export const queueSettingsProvider = () =>
  Provider.succeed(QueueSettings, {
    stables: ["accountId", "queueId"],
    diff: Effect.fn("Ironcage.Cloudflare.QueueSettings.diff")(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      if (
        output?.accountId !== accountId ||
        news.messageRetentionSeconds !== output?.messageRetentionSeconds
      ) {
        return { action: "update" } as const;
      }
    }),
    read: Effect.fn("Ironcage.Cloudflare.QueueSettings.read")(function* ({ olds }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const api = yield* CloudflareSettings;
      const messageRetentionSeconds = yield* api.getQueueRetention(accountId, olds.queueId);
      return { accountId, queueId: olds.queueId, messageRetentionSeconds };
    }),
    reconcile: Effect.fn("Ironcage.Cloudflare.QueueSettings.reconcile")(function* ({ news }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const api = yield* CloudflareSettings;
      yield* api.setQueueRetention(accountId, news.queueId, news.messageRetentionSeconds);
      return { accountId, ...news };
    }),
    delete: Effect.fn("Ironcage.Cloudflare.QueueSettings.delete")(function* ({ output }) {
      const api = yield* CloudflareSettings;
      yield* api.setQueueRetention(
        output.accountId,
        output.queueId,
        DEFAULT_QUEUE_RETENTION_SECONDS,
      );
    }),
  });
