import { CategorySummary, Conflict, NotFound, ValidationFailed } from "@ironcage/contracts/schema";
import { CategoryId, type CategoryKind, type RequestId, type Sha256 } from "@ironcage/domain";
import { Effect } from "effect";

import { mintId } from "../../ids";
import { runIdempotentMutation } from "../../persistence/app-requests";
import { persistenceToBoundary } from "../../persistence/error";
import { Postgres, type SqlExecutor } from "../../persistence/postgres";

const categoryColumns = `id, name, kind, system, archived`;

export const listCategoryRows = (sql: SqlExecutor) =>
  sql.rows(
    "list categories",
    CategorySummary,
    `SELECT ${categoryColumns} FROM categories ORDER BY system DESC, name`,
  );

export const getCategoryRow = (sql: SqlExecutor, id: CategoryId) =>
  Effect.map(
    sql.rows(
      "read category",
      CategorySummary,
      `SELECT ${categoryColumns} FROM categories WHERE id = $1`,
      [id],
    ),
    (rows) => rows[0] ?? null,
  );

export const requireActiveCategory = Effect.fn("requireActiveCategory")(function* (
  sql: SqlExecutor,
  categoryId: CategoryId,
) {
  const category = yield* getCategoryRow(sql, categoryId);
  if (category === null) {
    return yield* Effect.fail(new NotFound({ entity: "category", id: categoryId }));
  }
  if (category.archived) {
    return yield* Effect.fail(
      new ValidationFailed({
        reason: "ArchivedCategory",
        detail: `"${category.name}" is archived`,
      }),
    );
  }
  return category;
});

export const listCategories = Effect.fn("listCategories")(function* () {
  const postgres = yield* Postgres;
  return yield* postgres.readTransaction(listCategoryRows);
}, persistenceToBoundary);

export interface CreateCategoryInput {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly name: string;
  readonly kind: CategoryKind;
}

export const createCategory = (input: CreateCategoryInput) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "createCategory",
      payloadHash: input.payloadHash,
      response: CategorySummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const existing = yield* listCategoryRows(sql);
        if (existing.some((category) => category.name === input.name)) {
          return yield* Effect.fail(
            new Conflict({ reason: "DuplicateCategory", detail: `"${input.name}" already exists` }),
          );
        }
        const id = yield* mintId(CategoryId);
        yield* sql.execute(
          "insert category",
          `INSERT INTO categories (id, name, kind, system, archived, created_at)
           VALUES ($1, $2, $3, false, false, now())`,
          [id, input.name, input.kind],
        );
        return { id, name: input.name, kind: input.kind, system: false, archived: false };
      }),
  );

export interface EditCategoryInput {
  readonly requestId: RequestId;
  readonly payloadHash: Sha256;
  readonly categoryId: CategoryId;
  readonly name: string | null;
  readonly archived: boolean | null;
}

export const editCategory = (input: EditCategoryInput) =>
  runIdempotentMutation(
    {
      requestId: input.requestId,
      operation: "editCategory",
      payloadHash: input.payloadHash,
      response: CategorySummary,
    },
    (sql) =>
      Effect.gen(function* () {
        const category = yield* getCategoryRow(sql, input.categoryId);
        if (category === null) {
          return yield* Effect.fail(new NotFound({ entity: "category", id: input.categoryId }));
        }
        if (category.system) {
          return yield* Effect.fail(
            new ValidationFailed({
              reason: "SystemCategory",
              detail: "the system category cannot be renamed or archived",
            }),
          );
        }
        const name = input.name ?? category.name;
        const archived = input.archived ?? category.archived;
        yield* sql.execute(
          "update category",
          "UPDATE categories SET name = $2, archived = $3 WHERE id = $1",
          [category.id, name, archived],
        );
        return { ...category, name, archived };
      }),
  );
