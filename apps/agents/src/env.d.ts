interface AgentsEnv {
  CORE: Fetcher;
  DECISION_RECORDS: Queue<unknown>;
  AI_GATEWAY: Ai;
  AI_GATEWAY_TOKEN?: string;
  FLAGS: Flagship;
  ENVIRONMENT: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends AgentsEnv {}
    interface GlobalProps {
      mainModule: typeof import("./index");
    }
  }

  interface Env extends AgentsEnv {}
}

export {};
