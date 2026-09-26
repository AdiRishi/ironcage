import { FinanceError } from "@repo/contracts/finance";
import type { Input } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { PostgresLayer } from "alchemy/SQL/Postgres";
import { Effect } from "effect";

import { AnalystGateway, type Analyst } from "./analyst.ts";
import { Api, type AnalystOperation, type ApiClient, type financialStorage } from "./api.ts";
import { retentionPolicy } from "./database/retention.ts";
import type { DeploymentConfig } from "./deployment-config.ts";
import { EnrichmentGateway } from "./enrichment.ts";
import { modelProviders } from "./models.ts";
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
    modelProviders,
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
export const conversationBindings = Effect.fn("ApplicationPlatform.ConversationBindings")(
  function* () {
    const api: ApiClient<AnalystOperation> = yield* Cloudflare.Workers.bindWorker(Api, {
      errors: [FinanceError],
    });
    return { api, gateway: yield* Cloudflare.AI.QueryGateway(AnalystGateway) };
  },
);
export const websiteBindings = (
  environment: DeploymentConfig["environment"],
  api: Effect.Success<typeof Api>,
  analyst: Effect.Success<typeof Analyst>,
  access: { issuer: string; audience: Input<string> },
) => ({
  API: api,
  ANALYST: analyst,
  ENVIRONMENT: environment,
  ACCESS_ISSUER: access.issuer,
  ACCESS_AUDIENCE: access.audience,
});
export type WebsiteEnv = Cloudflare.InferEnv<ReturnType<typeof websiteBindings>>;
