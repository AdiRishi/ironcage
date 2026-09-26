import { Effect } from "effect";

import AnalystLive, { Analyst } from "./analyst.ts";
import ApiLive, { Api, financialStorage } from "./api.ts";
import ProcessorLive, { Processor } from "./processor.ts";

export const workerGraph = Effect.gen(function* () {
  yield* financialStorage;
  const processor = yield* Processor;
  const api = yield* Api;
  const analyst = yield* Analyst;
  return { api, processor, analyst };
}).pipe(Effect.provide([ApiLive, ProcessorLive, AnalystLive]));

export type Workers = Effect.Success<typeof workerGraph>;
