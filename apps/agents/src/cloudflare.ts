import { init } from "@flue/runtime";
import { CapabilityRunMessage, Internal, type FailureDetail } from "@ironcage/contracts/schema";
import {
  ConversationRpcs,
  DispatchRpcs,
  makeWorkerRequestContext,
  rpcHttpRoute,
  systemPingHandler,
} from "@ironcage/contracts/server";
import {
  WorkflowEntrypoint,
  WorkerEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { Effect, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { CategorizationAgent } from "./agents/categorization";
import {
  decodeCategorizationResult,
  toCategorizationOutput,
  type CategorizationAgentInput,
} from "./shared/categorization";

const worker = "ironcage-agents";
const workerRequest = makeWorkerRequestContext<Env, ExecutionContext>(
  "ironcage/agents/WorkerRequest",
);
const ping = (surface: string) =>
  Effect.flatMap(workerRequest.service, () => systemPingHandler({ worker, surface }));

const conversationSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(ConversationRpcs, ConversationRpcs.toLayer({ ping: () => ping("ConversationApi") })),
);

const dispatchSurface = HttpRouter.toWebHandler(
  rpcHttpRoute(
    DispatchRpcs,
    DispatchRpcs.toLayer({
      ping: () => ping("DispatchApi"),
      dispatchCategorization: (payload) =>
        Effect.flatMap(workerRequest.service, ({ env }) =>
          Effect.tryPromise({
            try: async () => {
              const existing = await env.CATEGORIZATION_WORKFLOW.get(payload.runId);
              const status = await existing.status();
              if (status.status === "unknown") {
                await env.CATEGORIZATION_WORKFLOW.create({ id: payload.runId, params: payload });
              }
              return { accepted: true };
            },
            catch: (cause) =>
              new Internal({
                detail: cause instanceof Error ? cause.message : "categorization admission failed",
              }),
          }),
        ),
    }),
  ),
);

export class ConversationApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return conversationSurface.handler(request, workerRequest.forRequest(this.env, this.ctx));
  }
}

export class DispatchApiEntrypoint extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return dispatchSurface.handler(request, workerRequest.forRequest(this.env, this.ctx));
  }
}

type CategorizationWorkflowParams = CategorizationAgentInput;

const validateMessage = Schema.decodeUnknownSync(CapabilityRunMessage);

const failureDetail = (cause: unknown): FailureDetail => ({
  reason: "AgentRunFailed",
  detail: cause instanceof Error ? cause.message.slice(0, 2_000) : "the agent run failed",
});

const decisionMessage = (
  run: CategorizationWorkflowParams,
  result:
    | { readonly _tag: "Output"; readonly output: ReturnType<typeof toCategorizationOutput> }
    | { readonly _tag: "Failed"; readonly failure: FailureDetail },
  gatewayLogIds: readonly string[],
) => {
  const message = {
    runId: run.runId,
    capability: "money.categorization",
    sleeveId: null,
    configVersion: run.configVersion,
    trigger: {
      _tag: "batch",
      bundleDigest: run.bundleDigest,
      batchIndex: run.batchIndex,
      inputDigest: run.inputDigest,
    },
    producedAt: new Date().toISOString(),
    result,
    decisionRecord: {
      asked: `categorize ${run.batch.length} bank transactions`,
      inputsSummary: {
        batchSize: run.batch.length,
        categories: run.categories.length,
        bundleDigest: run.bundleDigest,
        batchIndex: run.batchIndex,
        inputDigest: run.inputDigest,
      },
      decided:
        result._tag === "Output"
          ? { suggestions: result.output.suggestions.length }
          : { failed: result.failure },
      rationale:
        result._tag === "Output"
          ? `suggested categories for ${result.output.suggestions.length} transactions`
          : `run failed: ${result.failure.detail}`,
      model: run.model,
      gatewayLogIds,
      otelTraceId: null,
      otelParentSpanIds: [],
    },
  };
  validateMessage(message);
  // The decoded form contains DateTime values; Workflow steps persist the validated wire form.
  return message;
};

export class CategorizationWorkflow extends WorkflowEntrypoint<Env, CategorizationWorkflowParams> {
  override async run(
    event: Readonly<WorkflowEvent<CategorizationWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<void> {
    const run = event.payload;
    const agent = init(CategorizationAgent, { id: run.runId, uid: null });

    const receipt = await step.do("dispatch categorization agent", () =>
      agent.dispatch({ message: "Categorize the recorded batch.", initialData: run }),
    );

    const message = await step.do("read categorization result", async () => {
      try {
        const reply = await agent.read(receipt);
        const writes = reply.data["categorization"] ?? [];
        const result = decodeCategorizationResult(writes.at(-1));
        return decisionMessage(
          run,
          { _tag: "Output", output: toCategorizationOutput(result) },
          result.gatewayLogId === null ? [] : [result.gatewayLogId],
        );
      } catch (cause) {
        return decisionMessage(run, { _tag: "Failed", failure: failureDetail(cause) }, []);
      }
    });

    await step.do("deliver categorization decision", () => this.env.DECISION_RECORDS.send(message));
  }
}
