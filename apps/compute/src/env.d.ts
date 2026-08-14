import type { ComputeEnv } from "@ironcage/infra/worker-bindings";

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
