import {
  analystModel,
  type CommandId,
  type FinanceError,
  type ModelProvider,
  type ModelTask,
  type RecordModelUsage,
} from "@repo/contracts/finance";
import { estimateModelCost } from "@repo/finance";
import { Duration, Effect, Schedule } from "effect";
import type { AiError, Response } from "effect/unstable/ai";

// Where a failed model call stopped. A request that never reached the model may get
// through later (`unreachable`), unlike one the gateway or model turned down (`refused`).
// Any other failure comes after the reply arrived, while the reply was decoded or its tools
// ran, and a reply that arrived was billed, so it is never asked for again.
export const failureOf = (error: AiError.AiError) => {
  switch (error.reason._tag) {
    // Alchemy's model reports a Workers AI binding call that threw as UnknownError.
    case "UnknownError":
      return "unreachable";
    case "RateLimitError":
    case "InternalProviderError":
    case "NetworkError":
    case "QuotaExhaustedError":
    case "AuthenticationError":
    case "ContentPolicyError":
    case "InvalidRequestError":
      return error.isRetryable ? "unreachable" : "refused";
    default:
      return "unreadable";
  }
};

const tokens = (count: number | undefined) => (count === undefined ? null : BigInt(count));

// The usage of one model call, or of a call that got no reply the analyst could read when
// `usage` is null.
export function modelUsage(
  task: ModelTask,
  commandId: typeof CommandId.Type,
  provider: ModelProvider,
  usage: Response.Usage | null,
) {
  const inputTokens = tokens(usage?.inputTokens.total);
  const outputTokens = tokens(usage?.outputTokens.total);
  return {
    commandId,
    task,
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

type Reply = {
  readonly usage: Response.Usage;
  readonly toolCalls: ReadonlyArray<{ readonly name: string }>;
};

// Sends a request to the model, and sends it again after 1 and then 2 seconds while it
// never reached the model. `record` stores the call's usage, which is unknown when no
// reply arrived that could be read.
export const callModel = <A extends Reply, R, B>(
  request: Effect.Effect<A, AiError.AiError, R>,
  record: (usage: Response.Usage | null) => Effect.Effect<B, FinanceError>,
) =>
  request.pipe(
    Effect.retry({
      schedule: Schedule.exponential("1 second"),
      times: 2,
      while: (error) => failureOf(error) === "unreachable",
    }),
    Effect.tapError(() => record(null)),
    Effect.timed,
    Effect.flatMap(([elapsed, response]) =>
      record(response.usage).pipe(
        Effect.andThen(
          Effect.logInfo("The analyst's model replied", {
            millis: Duration.toMillis(elapsed),
            tools: response.toolCalls.map((part) => part.name),
            inputTokens: response.usage.inputTokens.total,
            cachedInputTokens: response.usage.inputTokens.cacheRead,
            outputTokens: response.usage.outputTokens.total,
          }),
        ),
        Effect.as(response),
      ),
    ),
  );
