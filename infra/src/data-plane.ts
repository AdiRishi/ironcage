import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

import { bucketLifecycleRules } from "./cloudflare-config.ts";

// Starter data plane. Stage 1 replaces it with Postgres, a retained sources
// bucket, and a Workflow; see docs/stages/starting-point.mdx.
export const ArtifactsDatabase = Cloudflare.D1.Database("ArtifactsDatabase", {
  migrations: "../migrations",
});
export const ArtifactsBucket = Cloudflare.R2.Bucket("ArtifactsBucket", {
  forceDestroy: true,
  lifecycleRules: [...bucketLifecycleRules],
});
export const ProfileDeadLetters = Cloudflare.Queues.Queue("ProfileDeadLetters");
export const ProfileJobs = Cloudflare.Queues.Queue("ProfileJobs");

export const dataPlane = Effect.gen(function* () {
  const database = yield* ArtifactsDatabase;
  const artifacts = yield* ArtifactsBucket;
  const deadLetters = yield* ProfileDeadLetters;
  const profileJobs = yield* ProfileJobs;
  return { artifacts, database, deadLetters, profileJobs };
});

export type DataPlane = Effect.Success<typeof dataPlane>;
