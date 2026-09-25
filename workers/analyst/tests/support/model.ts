import { Context, Effect, Layer, Ref, Schema, Stream } from "effect";
import { AiError, LanguageModel, type Prompt, type Response } from "effect/unstable/ai";

import { AnalystModel } from "../../src/platform/services.ts";

// What the model answers one request with, given the request's prompt: a reply, or a
// failure before any reply.
type Reply = (
  prompt: Prompt.Prompt,
) => Effect.Effect<ReadonlyArray<Response.PartEncoded>, AiError.AiError>;
type ToolCall = { readonly name: string; readonly params: unknown };

// 1,000,000 input tokens, 400,000 of them cached, and 100,000 output tokens.
const reported = {
  inputTokens: { total: 1_000_000, cacheRead: 400_000 },
  outputTokens: { total: 100_000 },
};
const unreported = { inputTokens: {}, outputTokens: {} };

const parts = (usage: Response.FinishPartEncoded["usage"], calls: ReadonlyArray<ToolCall>) => [
  ...calls.map(({ name, params }, index) => ({
    type: "tool-call" as const,
    id: `call_${index + 1}`,
    name,
    params,
  })),
  { type: "finish" as const, reason: "tool-calls" as const, usage },
];

// A reply that calls tools, in order, and reports its usage.
export const callTools =
  (...calls: ReadonlyArray<ToolCall>): Reply =>
  () =>
    Effect.succeed(parts(reported, calls));

// The same reply without a usage report.
export const callToolsUnreported =
  (...calls: ReadonlyArray<ToolCall>): Reply =>
  () =>
    Effect.succeed(parts(unreported, calls));

// A reply whose calls are written from what the tools returned so far, as a model cites
// the figure tokens it read.
export const callToolsReading =
  (write: (prompt: Prompt.Prompt) => Effect.Effect<ReadonlyArray<ToolCall>>): Reply =>
  (prompt) =>
    write(prompt).pipe(Effect.map((calls) => parts(reported, calls)));

export const requestFails =
  (reason: AiError.AiErrorReason): Reply =>
  () =>
    Effect.fail(AiError.make({ module: "ScriptedModel", method: "generateText", reason }));

// What `tool` returned the last time the prompt shows it called it.
export const lastResult = <Success extends Schema.Constraint>(
  tool: { readonly name: string; readonly successSchema: Success },
  prompt: Prompt.Prompt,
) =>
  Effect.gen(function* () {
    const result = prompt.content
      .flatMap((message) => (message.role === "tool" ? message.content : []))
      .findLast((part) => part.type === "tool-result" && part.name === tool.name);
    if (!result || result.type !== "tool-result")
      return yield* Effect.die(`The prompt has no result of ${tool.name}.`);
    return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(tool.successSchema))(
      result.result,
    ).pipe(Effect.orDie);
  });

// The prompt of every request the model received, in order.
class ModelRequests extends Context.Service<ModelRequests, Ref.Ref<ReadonlyArray<Prompt.Prompt>>>()(
  "@repo/analyst/tests/ModelRequests",
) {}

export const modelRequests = ModelRequests.use(Ref.get);

// The prompt of the model's request at `index`, counting from 0.
export const modelRequest = (index: number) =>
  modelRequests.pipe(
    Effect.flatMap((requests) => {
      const request = requests[index];
      return request
        ? Effect.succeed(request)
        : Effect.die(`The model received no request ${index}.`);
    }),
  );

// The model the analyst calls, answering each request with the next scripted reply. A
// request past the script is a mistake in the test. Each script keeps its own requests,
// so a layer built inside another's scope does not share them.
export const scriptedModel = (replies: ReadonlyArray<Reply>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const requests = yield* ModelRequests;
      return yield* LanguageModel.make({
        generateText: (options) =>
          Ref.getAndUpdate(requests, (sent) => [...sent, options.prompt]).pipe(
            Effect.flatMap((sent) => {
              const next = replies[sent.length];
              return next
                ? next(options.prompt).pipe(Effect.map((reply) => [...reply]))
                : Effect.die("The model was called more often than the test scripted.");
            }),
          ),
        streamText: () => Stream.die("The analyst never streams."),
      });
    }),
  ).pipe(
    Layer.provideMerge(Layer.effect(ModelRequests, Ref.make<ReadonlyArray<Prompt.Prompt>>([]))),
  );

// Every conversation's turns call the one scripted model.
export const scriptedAnalystModel = (replies: ReadonlyArray<Reply>) =>
  Layer.effect(
    AnalystModel,
    Effect.gen(function* () {
      const model = yield* LanguageModel.LanguageModel;
      return AnalystModel.of({
        conversation: () => Layer.succeed(LanguageModel.LanguageModel, model),
      });
    }),
  ).pipe(Layer.provideMerge(scriptedModel(replies)));
