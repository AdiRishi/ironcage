import {
  analystModel,
  CommandId,
  type ModelProvider,
  type RecordModelUsage,
} from "@repo/contracts/finance";
import { estimateModelCost } from "@repo/finance";
import type { Response } from "effect/unstable/ai";
import { v5 } from "uuid";

import type { StartedTurn } from "../storage/conversations.ts";

const tokens = (count: number | undefined) => (count === undefined ? null : BigInt(count));

// The usage of one model call in an attempt at a turn, or of a call that got no reply the
// analyst could read when `usage` is null. The command ID comes from the attempt and the
// call, so recording the same call again stores nothing new, and a turn that starts again
// records its new calls beside the old ones.
export function modelUsage(
  turn: Pick<StartedTurn, "id" | "attempt">,
  call: number,
  provider: ModelProvider,
  usage: Response.Usage | null,
) {
  const inputTokens = tokens(usage?.inputTokens.total);
  const outputTokens = tokens(usage?.outputTokens.total);
  return {
    commandId: CommandId.make(v5(`${turn.id}/${turn.attempt}/${call}`, v5.URL)),
    task: "analyst",
    model: analystModel,
    inputTokens,
    outputTokens,
    cost: estimateModelCost({
      provider,
      inputTokens,
      cachedInputTokens: BigInt(usage?.inputTokens.cacheRead ?? 0),
      outputTokens,
    }),
    status: usage === null ? "failed" : "success",
  } satisfies typeof RecordModelUsage.Type;
}
