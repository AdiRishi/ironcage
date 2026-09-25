import { Effect } from "effect";
import { Migrator, SqlClient } from "effect/unstable/sql";

// Each statement is its own `sql` call, because node:sqlite, which the tests run on,
// executes only the first statement of a string.
const migrations = {
  "0001_conversations": Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      next_reference INTEGER NOT NULL DEFAULT 1 CHECK (next_reference > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT`;
    yield* sql`CREATE INDEX conversations_recent ON conversations (updated_at DESC, id DESC)`;
    yield* sql`CREATE TABLE turns (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations (id),
      question TEXT NOT NULL,
      context TEXT CHECK (json_valid(context)),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'answered', 'blocked', 'failed')),
      answer TEXT CHECK (json_valid(answer)) CHECK ((answer IS NOT NULL) = (status = 'answered')),
      message TEXT CHECK ((message IS NOT NULL) = (status IN ('blocked', 'failed'))),
      attempts INTEGER NOT NULL DEFAULT 0,
      asked_at TEXT NOT NULL,
      finished_at TEXT CHECK ((finished_at IS NULL) = (status IN ('queued', 'running')))
    ) STRICT`;
    yield* sql`CREATE INDEX turns_conversation ON turns (conversation_id, asked_at, id)`;
    // A conversation answers one question at a time.
    yield* sql`CREATE UNIQUE INDEX turns_unfinished ON turns (conversation_id)
      WHERE status IN ('queued', 'running')`;
    yield* sql`CREATE INDEX turns_waiting ON turns (asked_at, id)
      WHERE status IN ('queued', 'running')`;
    yield* sql`CREATE TABLE turn_steps (
      turn_id TEXT NOT NULL REFERENCES turns (id),
      position INTEGER NOT NULL,
      label TEXT NOT NULL,
      records TEXT CHECK (json_valid(records)),
      PRIMARY KEY (turn_id, position)
    ) STRICT`;
  }),
};

export const migrate = Migrator.make({})({ loader: Migrator.fromRecord(migrations) });
