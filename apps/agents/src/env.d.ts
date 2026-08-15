import type { AgentsEnv } from "@ironcage/infra/worker-bindings";

declare global {
  namespace Cloudflare {
    interface Env extends AgentsEnv {}
    interface GlobalProps {
      mainModule: typeof import("./cloudflare");
    }
  }

  interface Env extends AgentsEnv {}
}

export {};
