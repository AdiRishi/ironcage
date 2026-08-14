import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { CloudflareSettings } from "../../src/providers/cloudflare-settings.ts";
import { cloudflareSettingsProviders } from "../../src/providers/index.ts";
import {
  DEFAULT_QUEUE_RETENTION_SECONDS,
  type BucketLockRule,
  type OperatorAccessPolicyAttributes,
} from "../../src/providers/types.ts";

const accountId = "00000000000000000000000000000000";

export const bucketLocks = new Map<string, readonly BucketLockRule[]>();
export const queueRetention = new Map<string, number>();
export const accessPolicies = new Map<string, OperatorAccessPolicyAttributes>();
let nextPolicyId = 1;

const settings = CloudflareSettings.of({
  getBucketLocks: (_accountId, bucketName) => Effect.succeed(bucketLocks.get(bucketName) ?? []),
  putBucketLocks: (_accountId, bucketName, rules) =>
    Effect.sync(() => bucketLocks.set(bucketName, [...rules])).pipe(Effect.asVoid),
  getQueueRetention: (_accountId, queueId) =>
    Effect.succeed(queueRetention.get(queueId) ?? DEFAULT_QUEUE_RETENTION_SECONDS),
  setQueueRetention: (_accountId, queueId, seconds) =>
    Effect.sync(() => queueRetention.set(queueId, seconds)).pipe(Effect.asVoid),
  getAccessPolicy: (_accountId, policyId) => Effect.succeed(accessPolicies.get(policyId)),
  findAccessPolicy: (_accountId, name) =>
    Effect.succeed(Array.from(accessPolicies.values()).find((policy) => policy.name === name)),
  createAccessPolicy: (_accountId, policy) =>
    Effect.sync(() => {
      const policyId = `policy-${nextPolicyId++}`;
      accessPolicies.set(policyId, { accountId, policyId, ...policy });
      return policyId;
    }),
  updateAccessPolicy: (_accountId, policyId, policy) =>
    Effect.sync(() => accessPolicies.set(policyId, { accountId, policyId, ...policy })).pipe(
      Effect.asVoid,
    ),
  deleteAccessPolicy: (_accountId, policyId) =>
    Effect.sync(() => accessPolicies.delete(policyId)).pipe(Effect.asVoid),
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
    bucketLocks.clear();
    queueRetention.clear();
    accessPolicies.clear();
    nextPolicyId = 1;
  }),
);

export const test = api.test.provider;
