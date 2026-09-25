import type { ConversationId } from "@repo/contracts/analyst";
import { Context, type Effect, type Layer } from "effect";
import type { LanguageModel } from "effect/unstable/ai";

// The object's alarm. Setting it runs the scheduled work as soon as the object is free.
export class Alarm extends Context.Service<Alarm, { readonly set: Effect.Effect<void> }>()(
  "@repo/analyst/platform/Alarm",
) {}

// The analyst's model, for the turns of one conversation.
export class AnalystModel extends Context.Service<
  AnalystModel,
  {
    readonly conversation: (id: ConversationId) => Layer.Layer<LanguageModel.LanguageModel>;
  }
>()("@repo/analyst/platform/AnalystModel") {}
