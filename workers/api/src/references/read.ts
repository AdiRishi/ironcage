import { PgClient } from "@effect/sql-pg";
import { ReferenceData } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

export const readReferenceData = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  const categories =
    yield* sql`SELECT id, parent_id AS "parentId", name, slug, tree, position, archived, version FROM categories ORDER BY tree DESC, position, name, id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.categories)),
    );
  const counterparties =
    yield* sql`SELECT id, name, kind, version FROM counterparties ORDER BY name, id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.counterparties)),
    );
  const tags = yield* sql`SELECT id, name, version FROM tags ORDER BY name, id`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.tags)),
  );
  const personalEvents =
    yield* sql`SELECT id, name, start_on::text AS "startOn", end_on::text AS "endOn", exclude_from_ordinary AS "excludeFromOrdinary", version FROM personal_events ORDER BY start_on, id`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(ReferenceData.fields.personalEvents)),
    );
  return { categories, counterparties, tags, personalEvents } satisfies typeof ReferenceData.Type;
});
