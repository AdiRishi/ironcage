import type { AnalystOperation, ApiClient } from "@repo/infra/api";
import { Layer } from "effect";

import { Conversations } from "./conversations/service.ts";
import { analystApi } from "./platform/api.ts";
import { TurnRunner } from "./turns/runner.ts";
import { WorkScheduler } from "./work/scheduler.ts";

// What the Conversations object serves, over its SQLite client, the API's binding, its
// alarm, and the model.
export const analystServices = (api: ApiClient<AnalystOperation>) =>
  Conversations.layer.pipe(
    Layer.provideMerge(WorkScheduler.layer),
    Layer.provide(TurnRunner.layer(analystApi(api))),
  );
