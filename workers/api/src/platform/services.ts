import {
  EnrichmentRunId,
  ExportId,
  type FactsRebuildInput,
  FinanceError,
  ImportId,
  type ModelProvider,
} from "@repo/contracts/finance";
import type { ReadWriteBucketClient } from "alchemy/Cloudflare/R2";
import { RuntimeContext } from "alchemy/RuntimeContext";
import { Context, Effect, Layer } from "effect";

const bucketService = Effect.fn("Bucket.initialize")(function* (client: ReadWriteBucketClient) {
  const runtime = yield* RuntimeContext;
  const provide = Effect.provideService(RuntimeContext, runtime);
  return {
    get: (key: string) => client.get(key).pipe(provide),
    put: (
      key: string,
      bytes: Uint8Array,
      options?: Omit<NonNullable<Parameters<ReadWriteBucketClient["put"]>[2]>, "contentLength">,
    ) => client.put(key, bytes, options).pipe(provide),
    delete: (key: string) => client.delete(key).pipe(provide),
    createMultipartUpload: (
      key: string,
      options?: Parameters<ReadWriteBucketClient["createMultipartUpload"]>[1],
    ) => client.createMultipartUpload(key, options).pipe(provide),
  };
});

export class Sources extends Context.Service<
  Sources,
  Effect.Success<ReturnType<typeof bucketService>>
>()("@repo/api/platform/Sources") {
  static readonly layer = (client: ReadWriteBucketClient) =>
    Layer.effect(Sources, bucketService(client));
}

export class TemporaryExports extends Context.Service<
  TemporaryExports,
  Effect.Success<ReturnType<typeof bucketService>>
>()("@repo/api/platform/TemporaryExports") {
  static readonly layer = (client: ReadWriteBucketClient) =>
    Layer.effect(TemporaryExports, bucketService(client));
}

export interface WorkflowState {
  readonly status: string;
  readonly failure: string | null;
}
export const workflowEnded = (state: WorkflowState) =>
  state.status === "errored" || state.status === "terminated" || state.status === "complete";

interface JobClient<Start, R = RuntimeContext> {
  readonly start: (input: Start) => Effect.Effect<void, FinanceError, R>;
  readonly status: (input: { instanceId: string }) => Effect.Effect<WorkflowState, FinanceError, R>;
}

export const ensureWorkflowStatus = Effect.fn("ensureWorkflowStatus")(
  function* <Start>(client: JobClient<Start, never>, input: Start, instanceId: string) {
    // createBatch is idempotent, including when a previous request lost its response.
    yield* client.start(input);
    return yield* client.status({ instanceId });
  },
  Effect.catchIf(
    (error) => error.kind === "unavailable",
    () => Effect.succeed(null),
  ),
);
const jobService = Effect.fnUntraced(function* <Start>(client: JobClient<Start>) {
  const runtime = yield* RuntimeContext;
  const provide = Effect.provideService(RuntimeContext, runtime);
  return {
    start: (input: Start) => client.start(input).pipe(provide),
    status: (input: { instanceId: string }) => client.status(input).pipe(provide),
  };
});

export class ImportJobs extends Context.Service<
  ImportJobs,
  Effect.Success<
    ReturnType<typeof jobService<{ importId: typeof ImportId.Type; instanceId: string }>>
  >
>()("@repo/api/platform/ImportJobs") {
  static readonly layer = (
    client: JobClient<{ importId: typeof ImportId.Type; instanceId: string }>,
  ) => Layer.effect(ImportJobs, jobService(client));
}

export class ExportJobs extends Context.Service<
  ExportJobs,
  Effect.Success<ReturnType<typeof jobService<{ exportId: typeof ExportId.Type }>>>
>()("@repo/api/platform/ExportJobs") {
  static readonly layer = (client: JobClient<{ exportId: typeof ExportId.Type }>) =>
    Layer.effect(ExportJobs, jobService(client));
}

export class EnrichmentJobs extends Context.Service<
  EnrichmentJobs,
  Effect.Success<ReturnType<typeof jobService<{ runId: typeof EnrichmentRunId.Type }>>>
>()("@repo/api/platform/EnrichmentJobs") {
  static readonly layer = (client: JobClient<{ runId: typeof EnrichmentRunId.Type }>) =>
    Layer.effect(EnrichmentJobs, jobService(client));
}

export class FactJobs extends Context.Service<
  FactJobs,
  Effect.Success<ReturnType<typeof jobService<typeof FactsRebuildInput.Type>>>
>()("@repo/api/platform/FactJobs") {
  static readonly layer = (client: JobClient<typeof FactsRebuildInput.Type>) =>
    Layer.effect(FactJobs, jobService(client));
}

export class EnrichmentConfig extends Context.Service<
  EnrichmentConfig,
  { readonly provider: ModelProvider }
>()("@repo/api/platform/EnrichmentConfig") {}
