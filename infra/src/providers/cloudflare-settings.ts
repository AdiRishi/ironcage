import * as queues from "@distilled.cloud/cloudflare/queues";
import * as r2 from "@distilled.cloud/cloudflare/r2";
import * as zeroTrust from "@distilled.cloud/cloudflare/zero-trust";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  DEFAULT_QUEUE_RETENTION_SECONDS,
  type BucketLockRule,
  type OperatorAccessPolicyAttributes,
  type OperatorAccessPolicyProps,
} from "./types.ts";

interface CloudflareSettingsService {
  readonly getBucketLocks: (
    accountId: string,
    bucketName: string,
  ) => Effect.Effect<readonly BucketLockRule[], unknown>;
  readonly putBucketLocks: (
    accountId: string,
    bucketName: string,
    rules: readonly BucketLockRule[],
  ) => Effect.Effect<void, unknown>;
  readonly getQueueRetention: (
    accountId: string,
    queueId: string,
  ) => Effect.Effect<number, unknown>;
  readonly setQueueRetention: (
    accountId: string,
    queueId: string,
    seconds: number,
  ) => Effect.Effect<void, unknown>;
  readonly getAccessPolicy: (
    accountId: string,
    policyId: string,
  ) => Effect.Effect<OperatorAccessPolicyAttributes | undefined, unknown>;
  readonly findAccessPolicy: (
    accountId: string,
    name: string,
  ) => Effect.Effect<OperatorAccessPolicyAttributes | undefined, unknown>;
  readonly createAccessPolicy: (
    accountId: string,
    policy: OperatorAccessPolicyProps,
  ) => Effect.Effect<string, unknown>;
  readonly updateAccessPolicy: (
    accountId: string,
    policyId: string,
    policy: OperatorAccessPolicyProps,
  ) => Effect.Effect<void, unknown>;
  readonly deleteAccessPolicy: (
    accountId: string,
    policyId: string,
  ) => Effect.Effect<void, unknown>;
}

export class CloudflareSettings extends Context.Service<
  CloudflareSettings,
  CloudflareSettingsService
>()("ironcage/infra/CloudflareSettings") {}

const AccessPolicyResponse = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  include: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  sessionDuration: Schema.optional(Schema.NullOr(Schema.String)),
  mfaConfig: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        allowedAuthenticators: Schema.optional(
          Schema.NullOr(Schema.Array(Schema.Literals(["totp", "biometrics", "security_key"]))),
        ),
        mfaDisabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
        sessionDuration: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});
const EmailRule = Schema.Struct({ email: Schema.Struct({ email: Schema.String }) });

const decodeAccessPolicy = Effect.fn("Ironcage.Cloudflare.DecodeAccessPolicy")(function* (
  accountId: string,
  input: unknown,
) {
  const policy = yield* Schema.decodeUnknownEffect(AccessPolicyResponse)(input);
  if (!policy.id || !policy.name) return undefined;

  const email = policy.include
    ?.map((rule) => Schema.decodeUnknownOption(EmailRule)(rule))
    .find(Option.isSome);

  return {
    accountId,
    policyId: policy.id,
    name: policy.name,
    email: email?.value.email.email ?? "",
    sessionDuration: policy.sessionDuration ?? "",
    mfa: {
      required: policy.mfaConfig?.mfaDisabled === false,
      allowedAuthenticators: policy.mfaConfig?.allowedAuthenticators ?? [],
      sessionDuration: policy.mfaConfig?.sessionDuration ?? "",
    },
  } satisfies OperatorAccessPolicyAttributes;
});

const requirePolicyId = (id: string | null | undefined) =>
  id === undefined || id === null
    ? Effect.fail(new Error("Cloudflare created an Access policy without an id"))
    : Effect.succeed(id);

export const cloudflareSettingsLive = Layer.effect(
  CloudflareSettings,
  Effect.gen(function* () {
    const context = yield* Effect.context<r2.CloudflareOpContext>();
    const provide = <A, E>(effect: Effect.Effect<A, E, r2.CloudflareOpContext>) =>
      effect.pipe(Effect.provide(context));

    return CloudflareSettings.of({
      getBucketLocks: (accountId, bucketName) =>
        provide(
          r2.getBucketLock({ accountId, bucketName }).pipe(
            Effect.map((response) =>
              (response.rules ?? []).map((rule) => ({
                id: rule.id,
                enabled: rule.enabled,
                prefix: rule.prefix ?? "",
                condition: rule.condition,
              })),
            ),
          ),
        ),
      putBucketLocks: (accountId, bucketName, rules) =>
        provide(r2.putBucketLock({ accountId, bucketName, rules: [...rules] }).pipe(Effect.asVoid)),
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
      getAccessPolicy: (accountId, policyId) =>
        provide(
          zeroTrust.getAccessPolicy({ accountId, policyId }).pipe(
            Effect.flatMap((policy) => decodeAccessPolicy(accountId, policy)),
            Effect.catchIf(
              (error) => "status" in error && error.status === 404,
              () => Effect.succeed(undefined),
            ),
          ),
        ),
      findAccessPolicy: (accountId, name) =>
        provide(
          zeroTrust.listAccessPolicies.pages({ accountId }).pipe(
            Stream.runCollect,
            Effect.flatMap((pages) =>
              Effect.forEach(
                Array.from(pages).flatMap((page) => page.result ?? []),
                (policy) => decodeAccessPolicy(accountId, policy),
              ),
            ),
            Effect.map((policies) => policies.find((policy) => policy?.name === name)),
          ),
        ),
      createAccessPolicy: (accountId, policy) =>
        provide(
          zeroTrust
            .createAccessPolicy({
              accountId,
              name: policy.name,
              decision: "allow",
              include: [{ email: { email: policy.email } }],
              sessionDuration: policy.sessionDuration,
              mfaConfig: {
                mfaDisabled: !policy.mfa.required,
                sessionDuration: policy.mfa.sessionDuration,
                allowedAuthenticators: [...policy.mfa.allowedAuthenticators],
              },
            })
            .pipe(Effect.flatMap((created) => requirePolicyId(created.id))),
        ),
      updateAccessPolicy: (accountId, policyId, policy) =>
        provide(
          zeroTrust
            .updateAccessPolicy({
              accountId,
              policyId,
              name: policy.name,
              decision: "allow",
              include: [{ email: { email: policy.email } }],
              sessionDuration: policy.sessionDuration,
              mfaConfig: {
                mfaDisabled: !policy.mfa.required,
                sessionDuration: policy.mfa.sessionDuration,
                allowedAuthenticators: [...policy.mfa.allowedAuthenticators],
              },
            })
            .pipe(Effect.asVoid),
        ),
      deleteAccessPolicy: (accountId, policyId) =>
        provide(
          zeroTrust.deleteAccessPolicy({ accountId, policyId }).pipe(
            Effect.asVoid,
            Effect.catchIf(
              (error) => "status" in error && error.status === 404,
              () => Effect.void,
            ),
          ),
        ),
    });
  }),
);
