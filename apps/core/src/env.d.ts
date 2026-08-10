import type { BacktestRunner } from "@ironcage/compute/entrypoints";

// Wrangler cannot see across the script boundary, so it generates a binding to
// a class in another Worker as an opaque `DurableObjectNamespace`.
declare global {
  interface Env {
    COMPUTE: DurableObjectNamespace<BacktestRunner>;
  }
}
