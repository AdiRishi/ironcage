import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { runClassification } from "../../workers/processor/src/classification/workflow.ts";
import { runExport } from "../../workers/processor/src/exports/workflow.ts";
import { runImport } from "../../workers/processor/src/imports/workflow.ts";
import { processor } from "../../workers/processor/src/index.ts";
import { Api, financialStorage } from "./api.ts";
import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import { classificationBindings, processorBindings } from "./worker-bindings.ts";

export class ImportWorkflow extends Cloudflare.Workflow<ImportWorkflow>()(
  "ImportWorkflow",
  Effect.gen(function* () {
    const api = yield* Cloudflare.Workers.bindWorker(Api);
    const storage = yield* financialStorage;
    const sources = yield* Cloudflare.R2.ReadBucket(storage.sources);
    return runImport(api, sources);
  }).pipe(Effect.provide(Cloudflare.R2.ReadBucketBinding)),
) {}

export class ExportWorkflow extends Cloudflare.Workflow<ExportWorkflow>()(
  "ExportWorkflow",
  Effect.gen(function* () {
    return runExport(yield* Cloudflare.Workers.bindWorker(Api));
  }),
) {}

export class ClassificationWorkflow extends Cloudflare.Workflow<ClassificationWorkflow>()(
  "ClassificationWorkflow",
  Effect.gen(function* () {
    return runClassification(
      yield* Cloudflare.Workers.bindWorker(Api),
      yield* classificationBindings(),
    );
  }).pipe(Effect.provide(Cloudflare.AI.QueryGatewayBinding)),
) {}

export class Processor extends Cloudflare.Worker<
  Processor,
  Pick<
    Effect.Success<ReturnType<typeof processor>>,
    | "getImportInstance"
    | "startImport"
    | "startExport"
    | "getExportInstance"
    | "startClassification"
    | "getClassificationInstance"
  >
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
