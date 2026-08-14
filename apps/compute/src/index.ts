import { initSync, toMarkdownBytes } from "@firecrawl/anydoc-wasm";
// Bundled as a compiled WebAssembly module; instantiated once per isolate.
import wasmModule from "@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm";
import type {
  ComputeObjectBinding,
  StatementExtractorBinding,
} from "@ironcage/infra/worker-bindings";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

/** The exact extractor identity recorded beside every derived artifact. */
const extractor = { package: "@firecrawl/anydoc-wasm", version: "0.1.7" } as const;

let initialized = false;
const ensureInitialized = () => {
  if (!initialized) {
    initSync({ module: wasmModule });
    initialized = true;
  }
};

export class BacktestRunner extends DurableObject<Env> implements ComputeObjectBinding {
  async ping() {
    return { worker: "ironcage-compute", object: "BacktestRunner" };
  }
}

/**
 * PDF-to-Markdown behind the isolation boundary: this Worker holds no
 * database credential and no general egress, and it returns derived text
 * plus the extractor identity — never a financial interpretation.
 */
export class StatementExtractor extends DurableObject<Env> implements StatementExtractorBinding {
  async ping() {
    return { worker: "ironcage-compute", object: "StatementExtractor" };
  }

  async extract(pdf: Uint8Array) {
    ensureInitialized();
    return { markdown: toMarkdownBytes(pdf, "pdf"), extractor };
  }
}

export default class extends WorkerEntrypoint<Env> {
  override fetch(): Response {
    return Response.json({ worker: "ironcage-compute" });
  }
}
