import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { runImport } from "../../workers/processor/src/imports/workflow.ts";
import { processor } from "../../workers/processor/src/index.ts";
import { Api, financialStorage } from "./api.ts";
import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import { processorBindings } from "./worker-bindings.ts";

export class ImportWorkflow extends Cloudflare.Workflow<ImportWorkflow>()(
  "ImportWorkflow",
  Effect.gen(function* () {
    const api = yield* Cloudflare.Workers.bindWorker(Api);
    const storage = yield* financialStorage;
    const sources = yield* Cloudflare.R2.ReadBucket(storage.sources);
    return runImport(api, sources);
  }).pipe(Effect.provide(Cloudflare.R2.ReadBucketBinding)),
) {}

export class Processor extends Cloudflare.Worker<
  Processor,
  Pick<Effect.Success<ReturnType<typeof processor>>, "getImportInstance" | "startImport">
>()("ProcessorWorker") {}

export default Processor.make(
  {
    main: import.meta.url,
    compatibility: workerCompatibility,
    workersDev: false,
    observability: workerObservability,
  },
  Effect.gen(function* () {
    const bindings = yield* processorBindings();
    return yield* processor(bindings);
  }),
);
