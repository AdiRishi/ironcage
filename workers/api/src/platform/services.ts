import { FinanceError, ImportId } from "@repo/contracts/finance";
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
    }) => Effect.Effect<string, FinanceError, RuntimeContext>;
  }
>()("@repo/api/platform/ImportJobs") {}
