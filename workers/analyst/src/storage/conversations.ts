import {
  Answer,
  AskContext,
  type ConversationCursor,
  ConversationId,
  ConversationSummary,
  Proposal,
  RecordLink,
  TurnId,
  TurnStep,
} from "@repo/contracts/analyst";
import { FinanceError, Instant } from "@repo/contracts/finance";
import { DateTime, Effect, Schema, Struct } from "effect";
import { SqlClient } from "effect/unstable/sql";

import { insertProposals, proposalJson } from "./proposals.ts";

// JSON columns hold the contract's JSON encoding. An answer's proposals change after it,
// so they have a table of their own.
export const ContextText = Schema.NullOr(Schema.fromJsonString(Schema.toCodecJson(AskContext)));
const AnswerText = Schema.fromJsonString(
  Schema.toCodecJson(Answer.mapFields(Struct.omit(["proposals"]))),
);
const RecordsText = Schema.NullOr(Schema.fromJsonString(Schema.toCodecJson(RecordLink)));

const askedColumns = {
  id: TurnId,
  question: Schema.String,
  context: ContextText,
  steps: Schema.fromJsonString(Schema.toCodecJson(Schema.Array(TurnStep))),
  askedAt: Instant,
};
const TurnRow = Schema.Union([
  Schema.Struct({ ...askedColumns, status: Schema.Literals(["queued", "running"]) }),
  Schema.Struct({
    ...askedColumns,
    status: Schema.Literal("answered"),
    answer: AnswerText,
    proposals: Schema.fromJsonString(Schema.toCodecJson(Schema.Array(Proposal))),
    finishedAt: Instant,
  }),
  Schema.Struct({
    ...askedColumns,
    status: Schema.Literals(["blocked", "failed"]),
    message: Schema.String,
    finishedAt: Instant,
  }),
]);
const SummaryRow = Schema.Struct({
  ...ConversationSummary.fields,
  answering: Schema.BooleanFromBit,
});
const AskedRow = Schema.Struct({
  conversationId: ConversationId,
  question: Schema.String,
  context: Schema.NullOr(Schema.String),
});
const WaitingRow = Schema.Struct({
  id: TurnId,
  status: Schema.Literals(["queued", "running"]),
  attempts: Schema.Int,
});
const ExistsRow = Schema.Struct({ exists: Schema.BooleanFromBit });
const StartedRow = Schema.Struct({
  id: TurnId,
  conversationId: ConversationId,
  question: Schema.String,
  context: ContextText,
  // The number of this attempt at the turn, from 1.
  attempt: Schema.Int,
});
export type StartedTurn = typeof StartedRow.Type;
const AnsweredRow = Schema.Struct({ question: Schema.String, answer: AnswerText });

// How a turn ended. An answered turn moves its conversation's count of cited figures and
// records to `nextReference`.
export type TurnOutcome =
  | { readonly status: "blocked" | "failed"; readonly message: string }
  | { readonly status: "answered"; readonly answer: Answer; readonly nextReference: number };

const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

export const readConversationPage = Effect.fn("readConversationPage")(function* (
  cursor: typeof ConversationCursor.Type | undefined,
  limit: number,
) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql`SELECT c.id, c.title, c.updated_at AS "updatedAt",
      EXISTS (SELECT 1 FROM turns t WHERE t.conversation_id = c.id AND t.status IN ('queued', 'running')) AS answering
    FROM conversations c
    WHERE ${cursor ? sql`(c.updated_at, c.id) < (${cursor.updatedAt}, ${cursor.id})` : sql`true`}
    ORDER BY c.updated_at DESC, c.id DESC LIMIT ${limit}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(SummaryRow))),
  );
});

export const readConversation = Effect.fn("readConversation")(function* (id: ConversationId) {
  const sql = yield* SqlClient.SqlClient;
  const [conversation] = yield* sql`SELECT id, title FROM conversations WHERE id = ${id}`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(
        Schema.Array(Schema.Struct({ id: ConversationId, title: Schema.String })),
      ),
    ),
  );
  if (!conversation)
    return yield* new FinanceError({
      kind: "notFound",
      message: "This conversation does not exist.",
    });
  const turns = yield* sql`SELECT t.id, t.question, t.context, t.status, t.answer, t.message,
      t.asked_at AS "askedAt", t.finished_at AS "finishedAt",
      (SELECT json_group_array(json_object('label', s.label, 'records', json(s.records))
        ORDER BY s.position) FROM turn_steps s WHERE s.turn_id = t.id) AS steps,
      (SELECT json_group_array(${proposalJson(sql)} ORDER BY p.position)
        FROM proposals p WHERE p.turn_id = t.id) AS proposals
    FROM turns t WHERE t.conversation_id = ${id} ORDER BY t.asked_at, t.id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(TurnRow))),
  );
  return {
    ...conversation,
    turns: turns.map((turn) =>
      turn.status === "answered"
        ? {
            ...Struct.omit(turn, ["proposals"]),
            answer: { ...turn.answer, proposals: turn.proposals },
          }
        : turn,
    ),
  };
});

// What an earlier ask with this turn's command ID sent, to tell a repeat from a reuse.
export const readAsked = Effect.fn("readAsked")(function* (id: TurnId) {
  const sql = yield* SqlClient.SqlClient;
  const [asked] =
    yield* sql`SELECT conversation_id AS "conversationId", question, context FROM turns WHERE id = ${id}`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(AskedRow))),
    );
  return asked;
});

export const readAnswering = Effect.fn("readAnswering")(function* (id: ConversationId) {
  const sql = yield* SqlClient.SqlClient;
  const [conversation] = yield* sql`SELECT EXISTS (SELECT 1 FROM turns t
      WHERE t.conversation_id = c.id AND t.status IN ('queued', 'running')) AS "exists"
    FROM conversations c WHERE c.id = ${id}`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(ExistsRow))),
  );
  if (!conversation)
    return yield* new FinanceError({
      kind: "notFound",
      message: "This conversation does not exist.",
    });
  return conversation.exists;
});

export const insertConversation = Effect.fn("insertConversation")(function* (
  id: ConversationId,
  title: string,
) {
  const sql = yield* SqlClient.SqlClient;
  const at = yield* now;
  yield* sql`INSERT INTO conversations (id, title, created_at, updated_at)
    VALUES (${id}, ${title}, ${at}, ${at})`;
});

export const insertTurn = Effect.fn("insertTurn")(function* (turn: {
  readonly id: TurnId;
  readonly conversationId: ConversationId;
  readonly question: string;
  readonly context: typeof ContextText.Encoded;
}) {
  const sql = yield* SqlClient.SqlClient;
  const at = yield* now;
  yield* sql`INSERT INTO turns (id, conversation_id, question, context, status, asked_at)
    VALUES (${turn.id}, ${turn.conversationId}, ${turn.question}, ${turn.context}, 'queued', ${at})`;
  yield* sql`UPDATE conversations SET updated_at = ${at} WHERE id = ${turn.conversationId}`;
});

// A turn an earlier attempt left running comes first, then the one waiting longest.
export const readNextTurn = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [turn] =
    yield* sql`SELECT id, status, attempts FROM turns WHERE status IN ('queued', 'running')
    ORDER BY status = 'running' DESC, asked_at, id LIMIT 1`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(WaitingRow))),
    );
  return turn;
});

export const readWaiting = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const [waiting] =
    yield* sql`SELECT EXISTS (SELECT 1 FROM turns WHERE status IN ('queued', 'running')) AS "exists"`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([ExistsRow]))),
    );
  return waiting.exists;
});

// The number the first figure or record a turn cites takes, which no earlier turn in
// its conversation used.
export const readNextReference = Effect.fn("readNextReference")(function* (id: TurnId) {
  const sql = yield* SqlClient.SqlClient;
  const [turn] = yield* sql`SELECT c.next_reference AS "nextReference"
    FROM turns t JOIN conversations c ON c.id = t.conversation_id WHERE t.id = ${id}`.pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ nextReference: Schema.Int })])),
    ),
  );
  return turn.nextReference;
});

// Starts an attempt at the turn. The steps an earlier attempt recorded go, so the turn
// shows only what this attempt reads.
export const startTurn = Effect.fn("startTurn")(function* (id: TurnId) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DELETE FROM turn_steps WHERE turn_id = ${id}`;
      const [turn] =
        yield* sql`UPDATE turns SET status = 'running', attempts = attempts + 1 WHERE id = ${id}
        RETURNING id, conversation_id AS "conversationId", question, context, attempts AS attempt`.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([StartedRow]))),
        );
      return turn;
    }),
  );
});

// Written as the turn reads, so the conversation shows each step while the turn runs.
export const insertStep = Effect.fn("insertStep")(function* (id: TurnId, step: TurnStep) {
  const sql = yield* SqlClient.SqlClient;
  const records = yield* Schema.encodeEffect(RecordsText)(step.records);
  yield* sql`INSERT INTO turn_steps (turn_id, position, label, records)
    SELECT ${id}, COALESCE(MAX(position), 0) + 1, ${step.label}, ${records}
    FROM turn_steps WHERE turn_id = ${id}`;
});

// The questions a conversation's analyst answered, oldest first.
export const readAnswers = Effect.fn("readAnswers")(function* (id: ConversationId) {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql`SELECT question, answer FROM turns
    WHERE conversation_id = ${id} AND status = 'answered' ORDER BY asked_at, id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(AnsweredRow))),
  );
});

export const finishTurn = Effect.fn("finishTurn")(function* (id: TurnId, outcome: TurnOutcome) {
  const sql = yield* SqlClient.SqlClient;
  const at = yield* now;
  if (outcome.status === "answered") {
    const answer = yield* Schema.encodeEffect(AnswerText)(outcome.answer);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`UPDATE turns SET status = 'answered', answer = ${answer}, finished_at = ${at}
          WHERE id = ${id}`;
        yield* insertProposals(id, outcome.answer.proposals);
        yield* sql`UPDATE conversations SET next_reference = ${outcome.nextReference}
          WHERE id = (SELECT conversation_id FROM turns WHERE id = ${id})`;
      }),
    );
  } else
    yield* sql`UPDATE turns SET status = ${outcome.status}, message = ${outcome.message},
      finished_at = ${at} WHERE id = ${id}`;
});
