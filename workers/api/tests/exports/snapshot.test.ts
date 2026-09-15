import { PgClient } from "@effect/sql-pg";
import { Effect, Schema } from "effect";
import { expect } from "vitest";

import { takeSnapshot } from "../../src/exports/snapshot.ts";
import { applicationTest } from "../support/application.ts";
import { account, reset } from "../support/fixtures.ts";

const { test, services } = applicationTest();
test(
  "the exported snapshot preserves full BIGINT precision and calendar dates in every table",
  Effect.gen(function* () {
    yield* reset;
    const sql = yield* PgClient.PgClient;
    const owner = yield* account();
    yield* sql`INSERT INTO postings (id, account_id, currency, amount_minor, posted_on, description) VALUES ('f605f95a-f1c9-4997-90b1-842d5e8d5656', ${owner.id}, 'AUD', 9007199254740993, '2026-09-01', 'Synthetic precision test')`;
    const snapshot = yield* takeSnapshot(sql);
    const tables =
      yield* sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.String }))),
        ),
      );
    expect(snapshot.tables.map((table) => table.name)).toEqual(tables.map((table) => table.name));
    const postings = snapshot.tables.find((table) => table.name === "postings");
    expect(postings?.count).toBe(1);
    const rows = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(
        Schema.Array(
          Schema.Struct({
            amount_minor: Schema.String,
            posted_on: Schema.String,
            created_at: Schema.String,
          }),
        ),
      ),
    )(postings?.json);
    expect(rows[0]?.amount_minor).toBe("9007199254740993");
    expect(rows[0]?.posted_on).toBe("2026-09-01");
    expect(rows[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  }).pipe(Effect.provide(services)),
);
