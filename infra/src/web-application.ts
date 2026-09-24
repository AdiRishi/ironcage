import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect } from "effect";

import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { websiteBindings } from "./worker-bindings.ts";
import type { Workers } from "./workers.ts";

export const webApplication = Effect.fn("ApplicationPlatform.WebApplication")(function* (
  config: DeploymentConfig,
  workers: Workers,
) {
  const { dev } = yield* AlchemyContext;
  const access = dev
    ? undefined
    : yield* Cloudflare.Access.Application("PrivateApplication", {
        type: "self_hosted",
        domain: Effect.succeed(config.web.domain ?? undefined),
        policies: [
          { decision: "allow", include: [{ email: yield* Config.String("ACCESS_EMAIL") }] },
        ],
        sessionDuration: "24h",
      });
  const issuer = dev ? "" : yield* Config.String("ACCESS_ISSUER");
  return yield* Cloudflare.Website.Vite("WebApplication", {
    rootDir: "../apps/web",
    main: "src/worker.ts",
    compatibility: workerCompatibility,
    workersDev: config.web.workersDev,
    domain: config.web.domain,
    access: Effect.succeed(access),
    observability: workerObservability,
    memo: {
      include: [
        "**/*",
        "../../packages/*/src/**",
        "../../packages/*/package.json",
        "../../tooling/tsconfig/**",
      ],
      lockfile: true,
    },
    env: websiteBindings(config.environment, workers.api, { issuer, audience: access?.aud ?? "" }),
  });
});
