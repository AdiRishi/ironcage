import type { AnalystOperation, ApiClient } from "@repo/infra/api";
import { Layer } from "effect";

import { Conversations } from "./conversations/service.ts";
import { analystApi } from "./platform/api.ts";
import { Proposals } from "./proposals/service.ts";
import { TurnRunner } from "./turns/runner.ts";
import { WorkScheduler } from "./work/scheduler.ts";

// What the Conversations object serves, over its SQLite client, the API's binding, its
// alarm, and the model.
export const analystServices = (binding: ApiClient<AnalystOperation>) => {
  const api = analystApi(binding);
  return Layer.mergeAll(Conversations.layer, Proposals.layer(api)).pipe(
    Layer.provideMerge(WorkScheduler.layer),
    Layer.provide(TurnRunner.layer(api)),
  );
};
