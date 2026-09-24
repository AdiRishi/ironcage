import type { Input } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { PostgresLayer } from "alchemy/SQL/Postgres";
import { Effect } from "effect";

import type { Api, financialStorage } from "./api.ts";
import { retentionPolicy } from "./database/retention.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { EnrichmentGateway, enrichmentProvider } from "./enrichment.ts";
import {
  EnrichmentWorkflow,
  ExportWorkflow,
  FactsWorkflow,
  ImportWorkflow,
  Processor,
} from "./processor.ts";

export const apiBindings = Effect.fn("ApplicationPlatform.ApiBindings")(function* (
  storage: Effect.Success<typeof financialStorage>,
) {
  const connection = yield* Cloudflare.Hyperdrive.Connect(storage.database);
  const sources = yield* Cloudflare.R2.ReadWriteBucket(storage.sources);
  const processor = yield* Cloudflare.Workers.bindWorker(Processor);
  return {
    enrichmentProvider,
    retention: yield* retentionPolicy,
    sources,
    exports: yield* Cloudflare.R2.ReadWriteBucket(storage.exports),
    processor,
    database: PostgresLayer({ url: connection.connectionString }),
  };
});
export const processorBindings = Effect.fn("ApplicationPlatform.ProcessorBindings")(function* () {
  const imports = yield* ImportWorkflow;
  return {
    imports,
    exports: yield* ExportWorkflow,
    enrichment: yield* EnrichmentWorkflow,
    facts: yield* FactsWorkflow,
  };
});
export const enrichmentBindings = Effect.fn("ApplicationPlatform.EnrichmentBindings")(function* () {
  return yield* Cloudflare.AI.QueryGateway(EnrichmentGateway);
});
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
