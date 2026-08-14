import type { AppEnv } from "@ironcage/infra/worker-bindings";

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

export {};
