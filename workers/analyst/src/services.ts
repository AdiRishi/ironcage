import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import type { AnalystOperation, ApiClient } from "@repo/infra/api";
import { Layer } from "effect";

import { Briefings } from "./briefings/service.ts";
import { BriefingWriter } from "./briefings/writer.ts";
import { Conversations } from "./conversations/service.ts";
import { analystApi } from "./platform/api.ts";
import { Proposals } from "./proposals/service.ts";
import { TurnRunner } from "./turns/runner.ts";
import { WorkScheduler } from "./work/scheduler.ts";

// What the Conversations object serves, over its SQLite client, the API's binding, its
// alarm, and the model. Web Crypto is in every runtime the object runs in.
export const analystServices = (binding: ApiClient<AnalystOperation>) => {
  const api = analystApi(binding);
  return Layer.mergeAll(Conversations.layer, Proposals.layer(api), Briefings.layer(api)).pipe(
    Layer.provideMerge(WorkScheduler.layer),
    Layer.provide([TurnRunner.layer(api), BriefingWriter.layer(api)]),
    Layer.provide(BrowserCrypto.layer),
  );
};
