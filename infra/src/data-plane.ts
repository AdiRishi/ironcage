import { fileURLToPath } from "node:url";

import { adopt } from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Planetscale from "alchemy/Planetscale";
import { retain } from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";

import type { DeploymentConfig } from "./deployment-config.ts";
import { cloudflareResourceNames } from "./resource-names.ts";

const migrationsDir = fileURLToPath(new URL("../../migrations", import.meta.url));
const runtimeRoles = ["pg_read_all_data", "pg_write_all_data"] as const;

export const dataPlane = Effect.fn("Ironcage.DataPlane")(function* (config: DeploymentConfig) {
  const names = cloudflareResourceNames(config.stage);
  const database =
    config._tag === "Production"
      ? yield* Planetscale.PostgresDatabase("Database", {
          name: "ironcage",
          region: { slug: "aws-ap-southeast-2" },
          clusterSize: "PS_5",
          arch: "arm",
          replicas: 0,
          defaultBranch: "main",
          migrationsDir,
          migrationsTable: "__alchemy_migrations",
          requireApprovalForDeploy: true,
          restrictBranchRegion: true,
          productionBranchWebConsole: false,
        }).pipe(adopt(true), retain())
      : yield* Planetscale.PostgresDatabase.ref("Database", { stage: "prod" });

  const branch =
    config._tag === "Production"
      ? "main"
      : yield* Planetscale.PostgresBranch("DevelopmentBranch", {
          name: "dev",
          database,
          parentBranch: "main",
          clusterSize: "PS_DEV_AWS_ARM",
          replicas: 0,
          migrationsDir,
          migrationsTable: "__alchemy_migrations",
        }).pipe(adopt(true), retain());

  const uncachedRole = yield* Planetscale.PostgresRole("UncachedRuntimeRole", {
    name: config._tag === "Production" ? "ironcage_runtime" : "ironcage_dev_runtime",
    database,
    branch,
    inheritedRoles: [...runtimeRoles],
  });
  const cachedRole = yield* Planetscale.PostgresRole("CachedRuntimeRole", {
    name: config._tag === "Production" ? "ironcage_analytics" : "ironcage_dev_analytics",
    database,
    branch,
    inheritedRoles: [...runtimeRoles],
  });

  const uncachedDatabase = yield* Cloudflare.Hyperdrive.Connection("UncachedDatabase", {
    name: names.hyperdrive.uncached,
    origin: uncachedRole.origin,
    ...(config._tag === "Development" && { dev: uncachedRole.pooledOrigin }),
    caching: { disabled: true },
    originConnectionLimit: 8,
  }).pipe(adopt(config._tag === "Production"));
  const cachedDatabase = yield* Cloudflare.Hyperdrive.Connection("CachedDatabase", {
    name: names.hyperdrive.cached,
    origin: cachedRole.origin,
    ...(config._tag === "Development" && { dev: cachedRole.pooledOrigin }),
    caching: { maxAge: 60, staleWhileRevalidate: 15 },
    originConnectionLimit: 8,
  }).pipe(adopt(config._tag === "Production"));

  return { cachedDatabase, uncachedDatabase };
});

export type DataPlane = Effect.Success<ReturnType<typeof dataPlane>>;
