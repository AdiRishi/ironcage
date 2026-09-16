import type { Input } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { PostgresLayer } from "alchemy/SQL/Postgres";
import { Effect } from "effect";

import type { Api, financialStorage } from "./api.ts";
import { ClassificationGateway, classificationProvider } from "./classification.ts";
import { retentionPolicy } from "./database/retention.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { ClassificationWorkflow, ExportWorkflow, ImportWorkflow, Processor } from "./processor.ts";

export const apiBindings = Effect.fn("ApplicationPlatform.ApiBindings")(function* (
  storage: Effect.Success<typeof financialStorage>,
) {
  const connection = yield* Cloudflare.Hyperdrive.Connect(storage.database);
  const sources = yield* Cloudflare.R2.ReadWriteBucket(storage.sources);
  const processor = yield* Cloudflare.Workers.bindWorker(Processor);
  return {
    classificationProvider,
    retention: yield* retentionPolicy,
    sources,
    exports: yield* Cloudflare.R2.ReadWriteBucket(storage.exports),
    processor,
    database: PostgresLayer({ url: connection.connectionString }),
  };
});
export const processorBindings = Effect.fn("ApplicationPlatform.ProcessorBindings")(function* () {
  const imports = yield* ImportWorkflow;
  return { imports, exports: yield* ExportWorkflow, classification: yield* ClassificationWorkflow };
});
export const classificationBindings = Effect.fn("ApplicationPlatform.ClassificationBindings")(
  function* () {
    return yield* Cloudflare.AI.QueryGateway(ClassificationGateway);
  },
);
export const websiteBindings = (
  environment: DeploymentConfig["environment"],
  api: Effect.Success<typeof Api>,
  access: { issuer: string; audience: Input<string> },
) => ({
  API: api,
  ENVIRONMENT: environment,
  ACCESS_ISSUER: access.issuer,
  ACCESS_AUDIENCE: access.audience,
});
export type WebsiteEnv = Cloudflare.InferEnv<ReturnType<typeof websiteBindings>>;
