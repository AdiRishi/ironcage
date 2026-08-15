import type { DeploymentConfig } from "./deployment-config.ts";

type Stage = DeploymentConfig["stage"];

const forStage = (productionName: string, stage: Stage) =>
  stage === "prod" ? productionName : `${productionName}-dev`;

export const cloudflareResourceNames = (stage: Stage) => ({
  workers: {
    app: forStage("ironcage-app", stage),
    core: forStage("ironcage-core", stage),
    agents: forStage("ironcage-agents", stage),
    compute: forStage("ironcage-compute", stage),
  },
  hyperdrive: {
    cached: forStage("ironcage-with-cache", stage),
    uncached: forStage("ironcage-without-cache", stage),
  },
  buckets: {
    blobs: forStage("ironcage-private", stage),
    agentArtifacts: forStage("ironcage-agent-artifacts", stage),
    backups: forStage("ironcage-backups", stage),
  },
  queues: {
    decisionRecords: forStage("ironcage-decision-records", stage),
    decisionRecordDeadLetters: forStage("ironcage-decision-records-dlq", stage),
  },
  aiGateway: forStage("ironcage", stage),
  flags: forStage("ironcage", stage),
});

export type CloudflareResourceNames = ReturnType<typeof cloudflareResourceNames>;
