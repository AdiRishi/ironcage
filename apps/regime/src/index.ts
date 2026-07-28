// The regime worker — the LLM's only seat in the system (M0 scaffold).
//
// On a candle-aligned cron it will assemble context from multiple independent
// sources, call the LLM through AI Gateway, validate the response against the
// RegimeSignal schema, and persist the signal plus a full audit snapshot.
// It has NO path to execution: its output is a database row the engine reads
// on its own schedule (docs/adr/0001). A failed or unparseable tick writes
// nothing — which the engine treats as stale, i.e. OFF. Fail closed.
import { Schema } from "effect";

import { RegimeSignal } from "@app/contracts/regime";

const decodeRegimeSignal = Schema.decodeUnknownSync(RegimeSignal);

export interface Env {
  // Arrives with M3 (see wrangler.jsonc):
  // DB: D1Database;
  // SNAPSHOTS: R2Bucket;
  // ANTHROPIC_API_KEY via AI Gateway.
}

export default {
  async scheduled(controller, _env): Promise<void> {
    // M3 wires: context assembly → AI Gateway → LLM → decode → persist.
    // Until then, demonstrate the contract the LLM's output must satisfy —
    // anything that fails this decode is a failed tick, never a guess.
    const example = decodeRegimeSignal({
      state: "OFF",
      confidence: 1,
      rationale: "M0 scaffold: no LLM wired; the only honest signal is OFF.",
      sources: [],
      generatedAt: Date.now(),
      staleAfterMs: 8 * 60 * 60 * 1000,
    });
    console.log(
      `regime tick @ ${new Date(controller.scheduledTime).toISOString()}: ` +
        `scaffold signal validated (state=${example.state}); nothing persisted yet`,
    );
  },
} satisfies ExportedHandler<Env>;
