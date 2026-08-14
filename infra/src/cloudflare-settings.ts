import * as queues from "@distilled.cloud/cloudflare/queues";
import * as r2 from "@distilled.cloud/cloudflare/r2";
import * as zeroTrust from "@distilled.cloud/cloudflare/zero-trust";
import * as Cloudflare from "alchemy/Cloudflare";
import { deepEqual, isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Resource, type Resource as AlchemyResource } from "alchemy/Resource";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

type IndefiniteLockRule = {
  id: string;
  enabled: boolean;
  prefix: string;
  condition: { type: "Indefinite" };
};

type BucketLockProps = {
  bucketName: string;
  rule: IndefiniteLockRule;
};

type BucketLock = AlchemyResource<
  "Ironcage.Cloudflare.BucketLock",
  BucketLockProps,
  { accountId: string; bucketName: string; rule: unknown }
>;

export const BucketLock = Resource<BucketLock>("Ironcage.Cloudflare.BucketLock");

const BucketLockProvider = () =>
  Provider.succeed(BucketLock, {
    stables: ["accountId", "bucketName"],
    diff: ({ news, output }) =>
      Effect.sync(() => {
        if (!isResolved(news)) return undefined;
        if (output === undefined || !deepEqual(news.rule, output.rule)) {
          return { action: "update" } as const;
        }
      }),
    read: Effect.fn(function* ({ olds }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const observed = yield* r2.getBucketLock({
        accountId,
        bucketName: olds.bucketName,
      });
      const rule = observed.rules?.find((candidate) => candidate.id === olds.rule.id);

      return rule
        ? {
            accountId,
            bucketName: olds.bucketName,
            rule: {
              id: rule.id,
              enabled: rule.enabled,
              prefix: rule.prefix ?? "",
              condition: rule.condition,
            },
          }
        : undefined;
    }),
    reconcile: Effect.fn(function* ({ news }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      yield* r2.putBucketLock({
        accountId,
        bucketName: news.bucketName,
        rules: [news.rule],
      });
      return { accountId, ...news };
    }),
    delete: Effect.fn(function* () {}),
  });

type QueueRetentionProps = {
  queueId: string;
  seconds: number;
};

type QueueRetention = AlchemyResource<
  "Ironcage.Cloudflare.QueueRetention",
  QueueRetentionProps,
  QueueRetentionProps & { accountId: string }
>;

export const QueueRetention = Resource<QueueRetention>("Ironcage.Cloudflare.QueueRetention");

const QueueRetentionProvider = () =>
  Provider.succeed(QueueRetention, {
    stables: ["accountId", "queueId"],
    diff: ({ news, output }) =>
      Effect.sync(() => {
        if (!isResolved(news)) return undefined;
        if (output === undefined || news.seconds !== output.seconds) {
          return { action: "update" } as const;
        }
      }),
    read: Effect.fn(function* ({ olds }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const queue = yield* queues.getQueue({ accountId, queueId: olds.queueId });
      const seconds = queue.settings?.messageRetentionPeriod;
      return seconds === null || seconds === undefined
        ? undefined
        : { accountId, queueId: olds.queueId, seconds };
    }),
    reconcile: Effect.fn(function* ({ news }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      yield* queues.patchQueue({
        accountId,
        queueId: news.queueId,
        settings: { messageRetentionPeriod: news.seconds },
      });
      return { accountId, ...news };
    }),
    delete: Effect.fn(function* () {}),
  });

type AccessMfaProps = {
  policyId: string;
  policyName: string;
  email: string;
  sessionDuration: string;
  authenticators: ("biometrics" | "security_key")[];
};

type AccessMfa = AlchemyResource<
  "Ironcage.Cloudflare.AccessMfa",
  AccessMfaProps,
  AccessMfaProps & { accountId: string }
>;

export const AccessMfa = Resource<AccessMfa>("Ironcage.Cloudflare.AccessMfa");

const AccessMfaProvider = () =>
  Provider.succeed(AccessMfa, {
    stables: ["accountId", "policyId"],
    diff: ({ news, output }) =>
      Effect.sync(() => {
        if (!isResolved(news)) return undefined;
        if (
          output === undefined ||
          !deepEqual(news, {
            policyId: output.policyId,
            policyName: output.policyName,
            email: output.email,
            sessionDuration: output.sessionDuration,
            authenticators: output.authenticators,
          })
        ) {
          return { action: "update" } as const;
        }
      }),
    read: Effect.fn(function* ({ olds }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      const policy = yield* zeroTrust.getAccessPolicy({
        accountId,
        policyId: olds.policyId,
      });
      const mfa = policy.mfaConfig;
      return mfa?.mfaDisabled === false && mfa.sessionDuration
        ? {
            accountId,
            ...olds,
            sessionDuration: mfa.sessionDuration,
            authenticators: (mfa.allowedAuthenticators ?? []).filter(
              (authenticator): authenticator is "biometrics" | "security_key" =>
                authenticator === "biometrics" || authenticator === "security_key",
            ),
          }
        : undefined;
    }),
    reconcile: Effect.fn(function* ({ news }) {
      const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment;
      yield* zeroTrust.updateAccessPolicy({
        accountId,
        policyId: news.policyId,
        decision: "allow",
        include: [{ email: { email: news.email } }],
        name: news.policyName,
        sessionDuration: news.sessionDuration,
        mfaConfig: {
          allowedAuthenticators: news.authenticators,
          mfaDisabled: false,
          sessionDuration: news.sessionDuration,
        },
      });
      return { accountId, ...news };
    }),
    delete: Effect.fn(function* () {}),
  });

export const customCloudflareProviders = () =>
  Layer.mergeAll(BucketLockProvider(), QueueRetentionProvider(), AccessMfaProvider()).pipe(
    Layer.provide(Cloudflare.CloudflareApiLive().pipe(Layer.orDie)),
  );
