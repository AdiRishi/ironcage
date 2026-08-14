import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

import { bucketLifecycleRules } from "./cloudflare-config.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { QueueSettings } from "./providers/index.ts";

export const platformControls = Effect.fn("Ironcage.PlatformControls")(function* (
  config: DeploymentConfig,
) {
  const blobs = yield* Cloudflare.R2.Bucket("Blobs", {
    name: "ironcage-private",
    lifecycleRules: [...bucketLifecycleRules],
  }).pipe(adopt(config._tag === "Production"), retain());
  const agentArtifacts = yield* Cloudflare.R2.Bucket("AgentArtifacts", {
    name: "ironcage-agent-artifacts",
    lifecycleRules: [...bucketLifecycleRules],
  }).pipe(retain());
  const backups = yield* Cloudflare.R2.Bucket("Backups", {
    name: "ironcage-backups",
    lifecycleRules: [...bucketLifecycleRules],
  }).pipe(retain());

  const decisionRecordDeadLetters = yield* Cloudflare.Queues.Queue("DecisionRecordDeadLetters", {
    name: "ironcage-decision-records-dlq",
  }).pipe(retain());
  const decisionRecords = yield* Cloudflare.Queues.Queue("DecisionRecords", {
    name: "ironcage-decision-records",
  }).pipe(retain());

  const aiGateway = yield* Cloudflare.AI.Gateway("AiGateway", {
    id: config._tag === "Production" ? "ironcage" : "ironcage-dev",
    authentication: true,
    cacheTtl: null,
    collectLogs: true,
    logManagement: config.gatewayLogLimit,
    logManagementStrategy: "DELETE_OLDEST",
    spendLimits: {
      enabled: true,
      rules: [
        {
          limit: config.gatewaySpendLimit,
          limitType: "cost",
          technique: "sliding",
          window: "1 day",
        },
      ],
    },
  }).pipe(retain());

  const flags = yield* Cloudflare.Flagship.App("Flags", {
    name: config._tag === "Production" ? "ironcage" : "ironcage-dev",
  }).pipe(retain());
  yield* Cloudflare.Flagship.Flag("LiveTrading", {
    appId: flags.appId,
    key: "trading.live_enabled",
    enabled: true,
    defaultVariation: "off",
    variations: { off: false, on: true },
    description: "Independent production brake for every live order path.",
  }).pipe(retain());

  if (config._tag === "Production") {
    yield* Effect.all(
      [
        QueueSettings("DecisionRecordRetention", {
          queueId: decisionRecords.queueId,
          messageRetentionSeconds: 14 * 24 * 60 * 60,
        }),
        QueueSettings("DecisionRecordDeadLetterRetention", {
          queueId: decisionRecordDeadLetters.queueId,
          messageRetentionSeconds: 14 * 24 * 60 * 60,
        }),
      ],
      { discard: true },
    );
  }

  return {
    agentArtifacts,
    aiGateway,
    backups,
    blobs,
    decisionRecordDeadLetters,
    decisionRecords,
    flags,
  };
});

export type PlatformControls = Effect.Success<ReturnType<typeof platformControls>>;
