import { Schema } from "effect";

import { CommandId, Instant } from "../finance/values.ts";
import { Answer } from "./answer.ts";
import { AskContext } from "./context.ts";
import { RecordLink } from "./references.ts";

export const ConversationId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("ConversationId"),
);
export type ConversationId = typeof ConversationId.Type;
export const TurnId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("TurnId"));
export type TurnId = typeof TurnId.Type;

// A null conversation starts a new one, titled from the question.
export const Ask = Schema.Struct({
  commandId: CommandId,
  conversationId: Schema.NullOr(ConversationId),
  question: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  context: Schema.NullOr(AskContext),
});
export type Ask = typeof Ask.Type;

// A turn waits `queued` until the analyst starts on it. `blocked` means the analyst is
// off or model usage reached the warning, and `failed` that it could not finish; both
// say why in `message`.
export const TurnStatus = Schema.Literals(["queued", "running", "answered", "blocked", "failed"]);
export type TurnStatus = typeof TurnStatus.Type;
// What the analyst read on the way to an answer, such as "Reading spending in Food for
// August 2026", and the screen that shows the same read.
export const TurnStep = Schema.Struct({ label: Schema.String, records: Schema.NullOr(RecordLink) });
export type TurnStep = typeof TurnStep.Type;
// `answer` is set once the turn is `answered`.
export const Turn = Schema.Struct({
  id: TurnId,
  question: Schema.String,
  context: Schema.NullOr(AskContext),
  status: TurnStatus,
  steps: Schema.Array(TurnStep),
  answer: Schema.NullOr(Answer),
  message: Schema.NullOr(Schema.String),
  askedAt: Instant,
  finishedAt: Schema.NullOr(Instant),
});
export type Turn = typeof Turn.Type;

export const ConversationInput = Schema.Struct({ conversationId: ConversationId });
export const Conversation = Schema.Struct({
  id: ConversationId,
  title: Schema.String,
  turns: Schema.Array(Turn),
});
export type Conversation = typeof Conversation.Type;

// `answering` is true while a question in the conversation is queued or running.
export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  title: Schema.String,
  updatedAt: Instant,
  answering: Schema.Boolean,
});
export type ConversationSummary = typeof ConversationSummary.Type;
export const ConversationCursor = Schema.Struct({ updatedAt: Instant, id: ConversationId });
export const ListConversations = Schema.Struct({
  cursor: Schema.optionalKey(ConversationCursor),
});
export const ConversationPage = Schema.Struct({
  rows: Schema.Array(ConversationSummary),
  nextCursor: Schema.NullOr(ConversationCursor),
});
export type ConversationPage = typeof ConversationPage.Type;
