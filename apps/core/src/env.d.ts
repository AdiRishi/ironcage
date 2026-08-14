import type { StatementExtractor } from "@ironcage/compute/entrypoints";

import type { FeedActor, SleeveActor, SystemCageActor, VenueActor } from "./index";

interface CoreEnv {
  DB: Hyperdrive;
  DB_CACHED: Hyperdrive;
  BLOBS: R2Bucket;
  AGENT_ARTIFACTS: R2Bucket;
  BACKUPS: R2Bucket;
  FLAGS: Flagship;
  COMPUTE: DurableObjectNamespace<import("@ironcage/compute/entrypoints").BacktestRunner>;
  STATEMENT_EXTRACTION: DurableObjectNamespace<StatementExtractor>;
  SLEEVES: DurableObjectNamespace<SleeveActor>;
  VENUES: DurableObjectNamespace<VenueActor>;
  SYSTEM_CAGE: DurableObjectNamespace<SystemCageActor>;
  FEEDS: DurableObjectNamespace<FeedActor>;
  GATE_PIPELINE: Workflow<unknown>;
  TAX_SYNC: Workflow<unknown>;
  REPORTS: Workflow<unknown>;
  MONEY_CATEGORIZATION: Workflow<unknown>;
  BACKUP: Workflow<unknown>;
  RESTORE_TEST: Workflow<unknown>;
  AGENTS: Fetcher;
  ENVIRONMENT: string;
  HEALTH_SIGNING_KEY: string;
  MONEY_IDENTITY_KEY: string;
  KRAKEN_KEY?: string;
  KRAKEN_SECRET?: string;
  KRAKEN_EXPORT_KEY?: string;
  KRAKEN_EXPORT_SECRET?: string;
  ALPACA_KEY?: string;
  ALPACA_SECRET?: string;
  EMAIL_KEY?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends CoreEnv {}
    interface GlobalProps {
      mainModule: typeof import("./index");
      durableNamespaces: "FeedActor" | "SleeveActor" | "SystemCageActor" | "VenueActor";
    }
  }

  interface Env extends CoreEnv {}
}

export {};
