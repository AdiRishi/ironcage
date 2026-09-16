import { ClassificationInput, ExportInput, FinanceError, ImportId } from "@repo/contracts/finance";
import type { processorBindings } from "@repo/infra/worker-bindings";
import type { WorkflowInstanceStatus } from "alchemy/Cloudflare/Workflows";
import { Effect } from "effect";

// Native Workflow bindings report failures as defects; callers see `unavailable`.
const unavailable = (message: string) =>
  Effect.catchDefect(() => Effect.fail(new FinanceError({ kind: "unavailable", message })));
const describe = (instance: WorkflowInstanceStatus) => ({
  status: instance.status,
  failure: instance.error?.message ?? null,
});

export const processor = (bindings: Effect.Success<ReturnType<typeof processorBindings>>) =>
  Effect.succeed({
    startClassification: Effect.fn("Processor.startClassification")(function* (
      input: typeof ClassificationInput.Type,
    ) {
      yield* bindings.classification.createBatch([{ id: input.runId, params: input }]);
    }, unavailable("Category suggestion processing could not start. Retry the request.")),
    getClassificationInstance: Effect.fn("Processor.getClassificationInstance")(function* ({
      instanceId,
    }: {
      instanceId: string;
    }) {
      return describe(yield* (yield* bindings.classification.get(instanceId)).status());
    }, unavailable("Category suggestion status is unavailable.")),
    startExport: Effect.fn("Processor.startExport")(function* (input: typeof ExportInput.Type) {
      yield* bindings.exports.createBatch([{ id: input.exportId, params: input }]);
    }, unavailable("Export processing could not start. Request a new export.")),
    getExportInstance: Effect.fn("Processor.getExportInstance")(function* ({
      instanceId,
    }: {
      instanceId: string;
    }) {
      return describe(yield* (yield* bindings.exports.get(instanceId)).status());
    }, unavailable("Export status is unavailable.")),
    startImport: Effect.fn("Processor.startImport")(function* ({
      importId,
      instanceId,
    }: {
      importId: typeof ImportId.Type;
      instanceId: string;
    }) {
      yield* bindings.imports.createBatch([{ id: instanceId, params: { importId, instanceId } }]);
    }, unavailable("Import processing could not start. Retry the import.")),
    getImportInstance: Effect.fn("Processor.getImportInstance")(function* ({
      instanceId,
    }: {
      instanceId: string;
    }) {
      return describe(yield* (yield* bindings.imports.get(instanceId)).status());
    }, unavailable("Import status is unavailable.")),
  });
