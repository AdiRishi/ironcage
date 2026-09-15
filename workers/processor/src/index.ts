import { ExportInput, FinanceError, ImportId } from "@repo/contracts/finance";
import type { processorBindings } from "@repo/infra/worker-bindings";
import { Effect } from "effect";

export const processor = (bindings: Effect.Success<ReturnType<typeof processorBindings>>) =>
  Effect.succeed({
    startExport: Effect.fn("Processor.startExport")(
      function* (input: typeof ExportInput.Type) {
        yield* bindings.exports.createBatch([{ id: input.exportId, params: input }]);
      },
      Effect.catchDefect(() =>
        Effect.fail(
          new FinanceError({
            kind: "unavailable",
            message: "Export processing could not start. Request a new export.",
          }),
        ),
      ),
    ),
    getExportInstance: Effect.fn("Processor.getExportInstance")(
      function* ({ instanceId }: { instanceId: string }) {
        const result = yield* (yield* bindings.exports.get(instanceId)).status();
        return { status: result.status, failure: result.error?.message ?? null };
      },
      Effect.catchDefect(() =>
        Effect.fail(
          new FinanceError({ kind: "unavailable", message: "Export status is unavailable." }),
        ),
      ),
    ),
    startImport: Effect.fn("Processor.startImport")(
      function* ({ importId, instanceId }: { importId: typeof ImportId.Type; instanceId: string }) {
        yield* bindings.imports.createBatch([{ id: instanceId, params: { importId, instanceId } }]);
      },
      Effect.catchDefect(() =>
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
      Effect.catchDefect(() =>
        Effect.fail(
          new FinanceError({ kind: "unavailable", message: "Import status is unavailable." }),
        ),
      ),
    ),
  });
