import * as Cloudflare from "alchemy/Cloudflare";
import { retain } from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { cloudflareResourceNames } from "./resource-names.ts";
import { appBindings } from "./worker-bindings.ts";
import type { Workers } from "./workers.ts";

export const operatorEdge = Effect.fn("Ironcage.OperatorEdge")(function* (
  config: DeploymentConfig,
  workers: Workers,
) {
  const names = cloudflareResourceNames(config.stage);
  const access =
    config._tag === "Production"
      ? yield* Effect.gen(function* () {
          const policy = yield* Cloudflare.Access.Policy("OperatorAccess", {
            name: "Ironcage operator",
            decision: "allow",
            include: [{ email: { email: config.accessEmail } }],
            sessionDuration: "720h",
          }).pipe(retain());

          return yield* Cloudflare.Access.Application("OperatorApplication", {
            type: "self_hosted",
            name: "Ironcage",
            domain: config.domain,
            sessionDuration: "720h",
            appLauncherVisible: false,
            policies: [policy.policyId],
          }).pipe(retain());
        })
      : undefined;

  const app = yield* Cloudflare.Website.Vite("AppWorker", {
    name: names.workers.app,
    rootDir: "../apps/app",
    compatibility: workerCompatibility,
    workersDev: false,
    ...(config._tag === "Production" && { domain: config.domain }),
    observability: workerObservability,
    assets: { runWorkerFirst: true },
    memo: {
      include: ["**/*", "../../packages/contracts/src/**", "../../packages/ui/src/**"],
      lockfile: true,
    },
    env: appBindings(workers.core, workers.agents, access?.aud ?? "", config.environment),
  });

  return { access, app };
});

export type OperatorEdge = Effect.Success<ReturnType<typeof operatorEdge>>;
