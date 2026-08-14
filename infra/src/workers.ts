import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import type { DataPlane } from "./data-plane.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import type { PlatformControls } from "./platform-controls.ts";
import { agentsBindings, computeBindings, coreBindings } from "./worker-bindings.ts";

export const workerGraph = Effect.fn("Ironcage.WorkerGraph")(function* (
  config: DeploymentConfig,
  data: DataPlane,
  platform: PlatformControls,
) {
  const compute = yield* Cloudflare.Worker("ComputeWorker", {
    name: "ironcage-compute",
    main: "../apps/compute/src/index.ts",
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
    env: computeBindings(platform, config.environment),
  });

  const core = yield* Cloudflare.Worker("CoreWorker", {
    name: "ironcage-core",
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
    name: "ironcage-agents",
    main: "../apps/agents/src/index.ts",
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
    env: agentsBindings(
      core,
      platform,
      config.environment,
      Option.getOrUndefined(config.aiGatewayToken),
    ),
  });

  yield* core.bind("AgentsDispatch", {
    bindings: [
      {
        type: "service",
        name: "AGENTS",
        service: agents.workerName,
        entrypoint: "DispatchApiEntrypoint",
      },
    ],
  });

  return { agents, compute, core };
});

export type Workers = Effect.Success<ReturnType<typeof workerGraph>>;
