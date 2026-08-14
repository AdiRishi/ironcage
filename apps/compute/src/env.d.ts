import type { BacktestRunner, StatementExtractor } from "./index";

interface ComputeEnv {
  BACKTEST: DurableObjectNamespace<BacktestRunner>;
  STATEMENT_EXTRACTION: DurableObjectNamespace<StatementExtractor>;
  BLOBS: R2Bucket;
  ENVIRONMENT: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends ComputeEnv {}
    interface GlobalProps {
      mainModule: typeof import("./index");
      durableNamespaces: "BacktestRunner" | "StatementExtractor";
    }
  }

  interface Env extends ComputeEnv {}
}

export {};
