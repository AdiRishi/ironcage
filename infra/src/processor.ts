import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

import { processor } from "../../workers/processor/src/index.ts";
import { workerCompatibility, workerObservability } from "./cloudflare-config.ts";
import { processorBindings } from "./worker-bindings.ts";

export class ImportWorkflow extends Cloudflare.Workflow<ImportWorkflow>()(
  "ImportWorkflow",
  Effect.succeed(
    Effect.fn("ImportWorkflow.run")(function* ({ importId }: { importId: string }) {
      return yield* Cloudflare.Workflows.task("identify-import", Effect.succeed({ importId }));
    }),
  ),
) {}

export class Processor extends Cloudflare.Worker<
  Processor,
  Pick<Effect.Success<ReturnType<typeof processor>>, "getImportInstance">
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
