import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

export class BacktestRunner extends DurableObject<Env> {
  async ping() {
    return { worker: "ironcage-compute", object: "BacktestRunner" };
  }
}

export class StatementExtractor extends DurableObject<Env> {
  async ping() {
    return { worker: "ironcage-compute", object: "StatementExtractor" };
  }
}

export default class extends WorkerEntrypoint<Env> {
  override fetch(): Response {
    return Response.json({ worker: "ironcage-compute" });
  }
}
