import { Container } from "@cloudflare/containers";
import type {
  ComputeObjectBinding,
  StatementExtractorBinding,
} from "@ironcage/infra/worker-bindings";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Schema } from "effect";

const StatementExtraction = Schema.Struct({
  markdown: Schema.String,
  extractor: Schema.Struct({
    package: Schema.Literal("@firecrawl/anydoc"),
    version: Schema.Literal("0.1.9"),
  }),
});

export class BacktestRunner extends DurableObject<Env> implements ComputeObjectBinding {
  async ping() {
    return { worker: "ironcage-compute", object: "BacktestRunner" };
  }
}

export class StatementExtractor extends Container<Env> implements StatementExtractorBinding {
  override defaultPort = 8080;
  override requiredPorts = [8080];
  override sleepAfter = "1m";
  override enableInternet = false;

  async ping() {
    await this.startAndWaitForPorts();
    return { worker: "ironcage-compute", object: "StatementExtractor" };
  }

  async extract(pdf: Uint8Array) {
    await this.startAndWaitForPorts();
    const response = await this.containerFetch("http://container/extract", {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: pdf,
    });
    if (!response.ok) throw new Error(`statement extraction failed (${response.status})`);
    return Schema.decodeUnknownSync(StatementExtraction)(await response.json());
  }
}

export default class extends WorkerEntrypoint<Env> {
  override fetch(): Response {
    return Response.json({ worker: "ironcage-compute" });
  }
}
