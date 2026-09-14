import { FinanceError, ImportId } from "@repo/contracts/finance";
import type { processorBindings } from "@repo/infra/worker-bindings";
import { Effect } from "effect";

export const processor = (bindings: Effect.Success<ReturnType<typeof processorBindings>>) =>
  Effect.succeed({
    startImport: Effect.fn("Processor.startImport")(
      function* ({ importId, instanceId }: { importId: typeof ImportId.Type; instanceId: string }) {
        yield* bindings.imports.createBatch([{ id: instanceId, params: { importId, instanceId } }]);
      },
      Effect.catchCause(() =>
        Effect.fail(
          new FinanceError({
            kind: "unavailable",
            message: "Import processing could not start. Retry the import.",
          }),
        ),
      ),
    ),
    getImportInstance: Effect.fn("Processor.getImportInstance")(
      function* ({ instanceId }: { instanceId: string }) {
        const instance = yield* bindings.imports.get(instanceId);
        const result = yield* instance.status();
        return { status: result.status, failure: result.error?.message ?? null };
      },
      Effect.catchCause(() =>
        Effect.fail(
          new FinanceError({ kind: "unavailable", message: "Import status is unavailable." }),
        ),
      ),
    ),
  });
