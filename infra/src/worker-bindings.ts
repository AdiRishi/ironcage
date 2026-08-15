import type * as Workers from "@cloudflare/workers-types";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import type { Input } from "alchemy/Input";
import type * as Redacted from "effect/Redacted";

export interface ComputeObjectBinding extends Workers.Rpc.DurableObjectBranded {
  ping(): Promise<{ readonly worker: string; readonly object: string }>;
}

/** The isolated PDF-to-Markdown seam; the extractor identity travels with every result. */
export interface StatementExtractorBinding extends ComputeObjectBinding {
  extract(pdf: Uint8Array): Promise<{
    readonly markdown: string;
    readonly extractor: { readonly package: string; readonly version: string };
  }>;
}

export interface ActorBinding extends Workers.Rpc.DurableObjectBranded {
  ping(): Promise<{ readonly worker: string; readonly object: string }>;
}

export interface CoreSecrets {
  readonly KRAKEN_KEY?: Redacted.Redacted<string>;
  readonly KRAKEN_SECRET?: Redacted.Redacted<string>;
  readonly KRAKEN_EXPORT_KEY?: Redacted.Redacted<string>;
  readonly KRAKEN_EXPORT_SECRET?: Redacted.Redacted<string>;
  readonly ALPACA_KEY?: Redacted.Redacted<string>;
  readonly ALPACA_SECRET?: Redacted.Redacted<string>;
  readonly EMAIL_KEY?: Redacted.Redacted<string>;
}

interface DataBindings {
  readonly cachedDatabase: Cloudflare.Hyperdrive.Connection;
  readonly uncachedDatabase: Cloudflare.Hyperdrive.Connection;
}

interface PlatformBindings {
  readonly agentArtifacts: Cloudflare.R2.Bucket;
  readonly aiGateway: Cloudflare.AI.Gateway;
  readonly backups: Cloudflare.R2.Bucket;
  readonly blobs: Cloudflare.R2.Bucket;
  readonly decisionRecords: Cloudflare.Queues.Queue;
  readonly flags: Cloudflare.Flagship.App;
}

export const computeBindings = (platform: PlatformBindings, environment: string) => ({
  BACKTEST: Cloudflare.DurableObject<ComputeObjectBinding>("BacktestRunner", {
    className: "BacktestRunner",
  }),
  STATEMENT_EXTRACTION: Cloudflare.DurableObject<StatementExtractorBinding>("StatementExtractor", {
    className: "StatementExtractor",
  }),
  BLOBS: platform.blobs,
  ENVIRONMENT: environment,
});

/**
 * The Workers' script names, declared once. A binding that addresses another
 * Worker's Durable Object takes the literal name rather than the resource's
 * `workerName` output: the name is fixed here anyway, and a literal is known
 * before anything is created, which a first-ever `dev` needs.
 */
export const workerNames = {
  compute: "ironcage-compute",
  core: "ironcage-core",
  agents: "ironcage-agents",
  app: "ironcage-app",
} as const;

export const coreBindings = (
  data: DataBindings,
  platform: PlatformBindings,
  environment: string,
  secrets: CoreSecrets,
) => ({
  DB: data.uncachedDatabase,
  DB_CACHED: data.cachedDatabase,
  BLOBS: platform.blobs,
  AGENT_ARTIFACTS: platform.agentArtifacts,
  BACKUPS: platform.backups,
  FLAGS: platform.flags,
  COMPUTE: Cloudflare.DurableObject<ComputeObjectBinding>("BacktestRunner", {
    className: "BacktestRunner",
    scriptName: workerNames.compute,
  }),
  STATEMENT_EXTRACTION: Cloudflare.DurableObject<StatementExtractorBinding>("StatementExtractor", {
    className: "StatementExtractor",
    scriptName: workerNames.compute,
  }),
  SLEEVES: Cloudflare.DurableObject<ActorBinding>("SleeveActor", {
    className: "SleeveActor",
  }),
  VENUES: Cloudflare.DurableObject<ActorBinding>("VenueActor", { className: "VenueActor" }),
  SYSTEM_CAGE: Cloudflare.DurableObject<ActorBinding>("SystemCageActor", {
    className: "SystemCageActor",
  }),
  FEEDS: Cloudflare.DurableObject<ActorBinding>("FeedActor", { className: "FeedActor" }),
  ENVIRONMENT: environment,
  HEALTH_SIGNING_KEY: Alchemy.makeRandom("HealthSigningKey"),
  MONEY_IDENTITY_KEY: Alchemy.makeRandom("MoneyIdentityKey"),
  ...secrets,
});

export const agentsBindings = (
  core: Cloudflare.Worker,
  platform: PlatformBindings,
  environment: string,
  aiGatewayToken: Redacted.Redacted<string> | undefined,
) => ({
  CORE: Cloudflare.WorkerEntrypoint(core, "AgentReadApiEntrypoint"),
  DECISION_RECORDS: platform.decisionRecords,
  // The gateway binds as a Workers AI binding; only a `run` that names the
  // gateway routes through it, so its id travels beside it.
  AI_GATEWAY: platform.aiGateway,
  AI_GATEWAY_ID: platform.aiGateway.gatewayId,
  FLAGS: platform.flags,
  ENVIRONMENT: environment,
  ...(aiGatewayToken === undefined ? {} : { AI_GATEWAY_TOKEN: aiGatewayToken }),
});

export const appBindings = (
  core: Cloudflare.Worker,
  agents: Cloudflare.Worker,
  accessAud: Input<string>,
  environment: string,
) => ({
  CORE: Cloudflare.WorkerEntrypoint(core, "AppApiEntrypoint"),
  AGENTS: Cloudflare.WorkerEntrypoint(agents, "ConversationApiEntrypoint"),
  ACCESS_AUD: accessAud,
  ENVIRONMENT: environment,
});

export type AgentsEnv = Cloudflare.InferEnv<ReturnType<typeof agentsBindings>>;
export type AppEnv = Cloudflare.InferEnv<ReturnType<typeof appBindings>>;
export type ComputeEnv = Cloudflare.InferEnv<ReturnType<typeof computeBindings>>;
export type CoreEnv = Cloudflare.InferEnv<ReturnType<typeof coreBindings>> & {
  readonly AGENTS: { readonly fetch: typeof globalThis.fetch };
};
