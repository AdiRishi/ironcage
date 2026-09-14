import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { PgClient } from "@effect/sql-pg";
import * as Alchemy from "alchemy";
import * as Planetscale from "alchemy/Planetscale";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Layer, Schema } from "effect";
import { expect, inject } from "vitest";

import { restoreVerificationDatabase } from "../src/database/restore.ts";

const providers = Planetscale.providers();
const Stack = Alchemy.Stack(
  "RestoreVerification",
  { providers, state: Alchemy.localState() },
  Effect.gen(function* () {
    const { source, backup, restored, reader } = yield* restoreVerificationDatabase(
      "tests/fixtures/restore.sql",
    );
    return {
      database: source.name,
      branch: restored.name,
      backupId: backup.id,
      completedAt: backup.completedAt,
      connectionUrl: reader.connectionUrl,
    };
  }),
);
const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers,
  stage: `test-${crypto.randomUUID().slice(0, 8)}`,
  dev: !inject("live"),
});
const stack = beforeAll(deploy(Stack), { timeout: 1_200_000 });
afterAll(destroy(Stack), { timeout: 600_000 });
const database = Layer.unwrap(
  Effect.map(stack, (result) => PgClient.layer({ url: result.connectionUrl })),
);

test(
  "a managed backup restores exact postings and resolved reviews, with originals recoverable from the independent archive",
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const postings =
      yield* sql`SELECT amount_minor::text AS amount, posted_on::text AS date FROM postings ORDER BY posted_on`.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Array(Schema.Struct({ amount: Schema.String, date: Schema.String })),
          ),
        ),
      );
    expect(postings).toEqual([
      { amount: "10000", date: "2026-08-01" },
      { amount: "-500", date: "2026-08-31" },
    ]);
    const resolutions =
      yield* sql`SELECT version, resolution->>'kind' AS kind, resolution->'decisions'->0->'decision'->>'kind' AS decision, resolved_at IS NOT NULL AS resolved FROM review_items`.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                version: Schema.Int,
                kind: Schema.String,
                decision: Schema.String,
                resolved: Schema.Boolean,
              }),
            ),
          ),
        ),
      );
    expect(resolutions).toEqual([
      { version: 2, kind: "observations", decision: "correct", resolved: true },
    ]);
    const sources = yield* sql`SELECT sha256 FROM source_files`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ sha256: Schema.String }))),
      ),
    );
    const archived = readFileSync(new URL("./fixtures/unreadable-date.csv", import.meta.url));
    expect(sources).toEqual([{ sha256: createHash("sha256").update(archived).digest("hex") }]);
    const restored = yield* stack;
    yield* Effect.logInfo("Managed restore verified", {
      database: restored.database,
      branch: restored.branch,
      backupId: restored.backupId,
      completedAt: restored.completedAt,
      postings: 2,
      resolvedReviews: 1,
      originalsVerified: 1,
    });
  }).pipe(Effect.provide(database)),
);
