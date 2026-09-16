import type { ClassificationProvider } from "@repo/contracts/finance";
import { Context } from "effect";
export class ClassificationConfig extends Context.Service<
  ClassificationConfig,
  { readonly provider: typeof ClassificationProvider.Type | null }
>()("@repo/api/ClassificationConfig") {}
