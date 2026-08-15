import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import type { DataPlane } from "./data-plane.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import type { PlatformControls } from "./platform-controls.ts";
import { cloudflareResourceNames } from "./resource-names.ts";
import {
  agentsBindings,
  agentsEntrypoints,
  bindWorkerEntrypoints,
  computeBindings,
  coreBindings,
  coreEntrypoints,
} from "./worker-bindings.ts";

export const workerGraph = Effect.fn("Ironcage.WorkerGraph")(function* (
  config: DeploymentConfig,
  data: DataPlane,
  platform: PlatformControls,
) {
  const names = cloudflareResourceNames(config.stage);
  const compute = yield* Cloudflare.Worker("ComputeWorker", {
    name: names.workers.compute,
    main: "../apps/compute/src/index.ts",
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
    crons: ["*/5 * * * *"],
    env: computeBindings(platform, config.environment),
  });

  const core = yield* Cloudflare.Worker("CoreWorker", {
    name: names.workers.core,
    main: "../apps/core/src/index.ts",
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
    env: coreBindings(
      data,
      platform,
      compute,
      config.environment,
      config._tag === "Production" ? config.coreSecrets : {},
    ),
  });

  const agents = yield* Cloudflare.Worker("AgentsWorker", {
    name: names.workers.agents,
    vite: {
      rootDir: "../apps/agents",
      viteEnvironments: { entry: "ironcage_agents" },
    },
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
    env: agentsBindings(platform, config.environment),
  });

  yield* bindWorkerEntrypoints(agents, agentsEntrypoints(core));
  yield* bindWorkerEntrypoints(core, coreEntrypoints(agents));

  // Cloudflare accepts a queue consumer only after the Worker upload exposes
  // its queue handler. The deployment hash keeps that ordering explicit.
  const coreWorkerNameAfterUpload = Output.all(core.workerName, core.hash).pipe(
    Output.map(([workerName]) => workerName),
  );

  // Core consumes capability runs one message at a time; exhausted deliveries
  // route to the dead-letter queue, whose consumer records the loss.
  yield* Cloudflare.Queues.Consumer("DecisionRecordConsumer", {
    queueId: platform.decisionRecords.queueId,
    scriptName: coreWorkerNameAfterUpload,
    deadLetterQueue: platform.decisionRecordDeadLetters.queueName,
    settings: { batchSize: 1, maxRetries: 9 },
  });
  yield* Cloudflare.Queues.Consumer("DecisionRecordDeadLetterConsumer", {
    queueId: platform.decisionRecordDeadLetters.queueId,
    scriptName: coreWorkerNameAfterUpload,
    settings: { batchSize: 1 },
  });

  return { agents, compute, core };
});

export type Workers = Effect.Success<ReturnType<typeof workerGraph>>;
