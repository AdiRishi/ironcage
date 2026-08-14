import { expect, it } from "@effect/vitest";
import { RequestId, Sha256 } from "@ironcage/domain";
import { Effect, Schema } from "effect";

import { runIdempotentMutation } from "../../src/persistence/app-requests";
import { Postgres } from "../../src/persistence/postgres";
import { usePostgresTestDatabase } from "./postgres-test-database";

const database = usePostgresTestDatabase();
const requestId = Schema.decodeUnknownSync(RequestId)("018f6b2a-7c4e-7d31-a2f0-3b9d4e8c1a55");
const payloadHash = Schema.decodeUnknownSync(Sha256)("a".repeat(64));
const response = Schema.Struct({ accepted: Schema.Boolean });

it.effect("serializes concurrent idempotent mutations through real PostgreSQL", () => {
  let applications = 0;
  const mutation = () =>
    runIdempotentMutation({ requestId, operation: "sleeve.pause", payloadHash, response }, () =>
      Effect.sync(() => {
        applications += 1;
        return { accepted: true };
      }),
    ).pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

  return Effect.gen(function* () {
    const results = yield* Effect.all([mutation(), mutation()], { concurrency: "unbounded" });

    expect(results).toEqual([{ accepted: true }, { accepted: true }]);
    expect(applications).toBe(1);

    const rows = yield* Effect.gen(function* () {
      const postgres = yield* Postgres;
      return yield* postgres.query(
        "count app requests",
        "SELECT count(*)::integer AS count FROM app_requests",
      );
    }).pipe(Effect.provide(Postgres.layerForRequest(database.connectionString())));

    expect(rows).toEqual([{ count: 1 }]);
  });
});
