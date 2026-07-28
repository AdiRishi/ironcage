// The Engine — the single-writer trading loop (M0 scaffold).
//
// One Durable Object instance is the only component in the system allowed to
// decide to trade. DO serialization makes concurrent double-ordering
// structurally impossible; the LLM reaches this code only as data (a
// RegimeSignal row read from the database — see docs/adr/0001).
import { DurableObject } from "cloudflare:workers";

import { defaultRiskConfig } from "@app/contracts/risk";
import { effectiveState } from "@app/core/regime/state";

export interface Env {
  ENGINE: DurableObjectNamespace<EngineDurableObject>;
  // Arrives with M0 data collection / M2 dry run (see wrangler.jsonc):
  // DB: D1Database;
  // HISTORY: R2Bucket;
}

/** Fixed name so exactly one instance ever exists. */
const SINGLETON = "engine";

export class EngineDurableObject extends DurableObject<Env> {
  /**
   * The slow tick — candle-aligned via alarms (never naive intervals).
   * M2 wires the real pipeline: refresh data → evaluate strategy on the last
   * CLOSED candle → read regime (stale ⇒ OFF) → risk cage → order intents.
   */
  override async alarm(): Promise<void> {
    // No regime signal exists yet, so the demonstrably correct behavior is to
    // stand down. `effectiveState(undefined, …)` is the fail-closed default
    // this whole system is built around.
    const regime = effectiveState(undefined, Date.now());
    console.log(`engine tick: regime=${regime} (fail-closed scaffold; no trading logic wired)`);
  }

  async status(): Promise<{
    mode: "dry-run";
    regime: string;
    riskConfig: typeof defaultRiskConfig;
  }> {
    return {
      mode: "dry-run",
      regime: effectiveState(undefined, Date.now()),
      riskConfig: defaultRiskConfig,
    };
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/status") {
      const stub = env.ENGINE.getByName(SINGLETON);
      return Response.json(await stub.status());
    }
    return new Response("ironcage engine", { status: 200 });
  },
} satisfies ExportedHandler<Env>;
