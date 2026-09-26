import { PgClient } from "@effect/sql-pg";
import { CategoryId, CategoryTree } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

const CategoryNode = Schema.Struct({
  id: CategoryId,
  parentId: Schema.NullOr(CategoryId),
  name: Schema.String,
  slug: Schema.NullOr(Schema.String),
  tree: CategoryTree,
  position: Schema.Int,
});

// Every category, archived ones included, since facts keep the categories they were
// placed on.
export const categoryNodes = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient;
  return yield* sql`SELECT id, parent_id AS "parentId", name, slug, tree, position FROM categories ORDER BY tree DESC, position, name`.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CategoryNode))),
  );
});
