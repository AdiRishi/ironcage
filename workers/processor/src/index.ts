import type { processorBindings } from "@repo/infra/worker-bindings";
import { Effect } from "effect";

export const processor = (bindings: Effect.Success<ReturnType<typeof processorBindings>>) =>
  Effect.succeed({
    getImportInstance: Effect.fn("Processor.getImportInstance")(function* ({
      instanceId,
    }: {
      instanceId: string;
    }) {
      const instance = yield* bindings.imports.get(instanceId);
      return yield* instance.status();
    }),
  });
