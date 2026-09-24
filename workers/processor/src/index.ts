import {
  EnrichmentInput,
  ExportInput,
  FactsRebuildInput,
  FinanceError,
  ImportId,
} from "@repo/contracts/finance";
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
    startEnrichment: Effect.fn("Processor.startEnrichment")(function* (
      input: typeof EnrichmentInput.Type,
    ) {
      yield* bindings.enrichment.createBatch([{ id: input.runId, params: input }]);
    }, unavailable("Counterparty identification could not start. Run it again.")),
    getEnrichmentInstance: Effect.fn("Processor.getEnrichmentInstance")(function* ({
      instanceId,
    }: {
      instanceId: string;
    }) {
      return describe(yield* (yield* bindings.enrichment.get(instanceId)).status());
    }, unavailable("Counterparty identification status is unavailable.")),
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
    startFactsRebuild: Effect.fn("Processor.startFactsRebuild")(function* (
      input: typeof FactsRebuildInput.Type,
    ) {
      yield* bindings.facts.createBatch([{ id: input.rebuildId, params: input }]);
    }, unavailable("Recalculating totals could not start.")),
    getFactsRebuildInstance: Effect.fn("Processor.getFactsRebuildInstance")(function* ({
      instanceId,
    }: {
      instanceId: string;
    }) {
      return describe(yield* (yield* bindings.facts.get(instanceId)).status());
    }, unavailable("Recalculation status is unavailable.")),
    getImportInstance: Effect.fn("Processor.getImportInstance")(function* ({
      instanceId,
    }: {
      instanceId: string;
    }) {
      return describe(yield* (yield* bindings.imports.get(instanceId)).status());
    }, unavailable("Import status is unavailable.")),
  });
