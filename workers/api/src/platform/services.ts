import { ExportId, FinanceError, ImportId } from "@repo/contracts/finance";
import type { ReadWriteBucketClient } from "alchemy/Cloudflare/R2";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import { Context, Effect } from "effect";

export class Sources extends Context.Service<Sources, ReadWriteBucketClient>()(
  "@repo/api/platform/Sources",
) {}
export class ImportJobs extends Context.Service<
  ImportJobs,
  {
    readonly start: (input: {
      importId: typeof ImportId.Type;
      instanceId: string;
    }) => Effect.Effect<void, FinanceError, RuntimeContext>;
    readonly status: (input: {
      instanceId: string;
    }) => Effect.Effect<{ status: string; failure: string | null }, FinanceError, RuntimeContext>;
  }
>()("@repo/api/platform/ImportJobs") {}

export class TemporaryExports extends Context.Service<TemporaryExports, ReadWriteBucketClient>()(
  "@repo/api/platform/TemporaryExports",
) {}
export class ExportJobs extends Context.Service<
  ExportJobs,
  {
    readonly start: (input: {
      exportId: typeof ExportId.Type;
    }) => Effect.Effect<void, FinanceError, RuntimeContext>;
    readonly status: (input: {
      instanceId: string;
    }) => Effect.Effect<{ status: string; failure: string | null }, FinanceError, RuntimeContext>;
  }
>()("@repo/api/platform/ExportJobs") {}
