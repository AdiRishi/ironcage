import { ExportId, FinanceError, ImportId } from "@repo/contracts/finance";
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

interface ImportJobClient {
  readonly start: (input: {
    importId: typeof ImportId.Type;
    instanceId: string;
  }) => Effect.Effect<void, FinanceError, RuntimeContext>;
  readonly status: (input: {
    instanceId: string;
  }) => Effect.Effect<{ status: string; failure: string | null }, FinanceError, RuntimeContext>;
}
const importJobs = Effect.fn("ImportJobs.initialize")(function* (client: ImportJobClient) {
  const runtime = yield* RuntimeContext;
  const provide = Effect.provideService(RuntimeContext, runtime);
  return {
    start: (input: Parameters<ImportJobClient["start"]>[0]) => client.start(input).pipe(provide),
    status: (input: Parameters<ImportJobClient["status"]>[0]) => client.status(input).pipe(provide),
  };
});
export class ImportJobs extends Context.Service<
  ImportJobs,
  Effect.Success<ReturnType<typeof importJobs>>
>()("@repo/api/platform/ImportJobs") {
  static readonly layer = (client: ImportJobClient) => Layer.effect(ImportJobs, importJobs(client));
}

interface ExportJobClient {
  readonly start: (input: {
    exportId: typeof ExportId.Type;
  }) => Effect.Effect<void, FinanceError, RuntimeContext>;
  readonly status: ImportJobClient["status"];
}
const exportJobs = Effect.fn("ExportJobs.initialize")(function* (client: ExportJobClient) {
  const runtime = yield* RuntimeContext;
  const provide = Effect.provideService(RuntimeContext, runtime);
  return {
    start: (input: Parameters<ExportJobClient["start"]>[0]) => client.start(input).pipe(provide),
    status: (input: Parameters<ExportJobClient["status"]>[0]) => client.status(input).pipe(provide),
  };
});
export class ExportJobs extends Context.Service<
  ExportJobs,
  Effect.Success<ReturnType<typeof exportJobs>>
>()("@repo/api/platform/ExportJobs") {
  static readonly layer = (client: ExportJobClient) => Layer.effect(ExportJobs, exportJobs(client));
}
