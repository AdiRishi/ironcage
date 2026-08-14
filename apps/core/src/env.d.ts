import type { CoreEnv } from "@ironcage/infra/worker-bindings";

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
