import * as Cloudflare from "alchemy/Cloudflare";
import { deepEqual, isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as AlchemyResource } from "alchemy/Resource";
import * as Effect from "effect/Effect";

import { CloudflareSettings } from "./cloudflare-settings.ts";
import type { BucketLocksAttributes, BucketLocksProps } from "./types.ts";

type BucketLocks = AlchemyResource<
  "Ironcage.Cloudflare.BucketLocks",
  BucketLocksProps,
  BucketLocksAttributes
>;

export const BucketLocks = Resource<BucketLocks>("Ironcage.Cloudflare.BucketLocks");

export const bucketLocksProvider = () =>
  Provider.succeed(BucketLocks, {
    stables: ["accountId", "bucketName"],
    diff: Effect.fn("Ironcage.Cloudflare.BucketLocks.diff")(function* ({ news, output }) {
      if (!isResolved(news)) return undefined;
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      if (output?.accountId !== accountId || !deepEqual(news.rules, output?.rules)) {
        return { action: "update" } as const;
      }
    }),
    read: Effect.fn("Ironcage.Cloudflare.BucketLocks.read")(function* ({ olds }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const api = yield* CloudflareSettings;
      const rules = yield* api.getBucketLocks(accountId, olds.bucketName);
      return { accountId, bucketName: olds.bucketName, rules };
    }),
    reconcile: Effect.fn("Ironcage.Cloudflare.BucketLocks.reconcile")(function* ({ news }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const api = yield* CloudflareSettings;
      yield* api.putBucketLocks(accountId, news.bucketName, news.rules);
      return { accountId, ...news };
    }),
    delete: Effect.fn("Ironcage.Cloudflare.BucketLocks.delete")(function* ({ output }) {
      const api = yield* CloudflareSettings;
      yield* api.putBucketLocks(output.accountId, output.bucketName, []);
    }),
  });
