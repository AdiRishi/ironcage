import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

export class BacktestRunner extends DurableObject<Env> {
  async ping() {
    return { worker: "ironcage-compute", object: "BacktestRunner" };
  }
}

export default class extends WorkerEntrypoint<Env> {
  override fetch(): Response {
    return Response.json({ worker: "ironcage-compute" });
  }
}
