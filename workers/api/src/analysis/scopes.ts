import { PgClient } from "@effect/sql-pg";
import { FinanceError, type Scope, type ScopeCrumb } from "@repo/contracts/finance";
import {
  categoryPath,
  uncategorisedLabel,
  unidentifiedLabel,
  unspecifiedLabel,
  type CategoryNode,
} from "@repo/finance";
import { Effect, Schema } from "effect";

const allCounterparties = { kind: "all" } as const;

// The crumbs that narrow a measure to a scope: its category and the categories above it,
// top-level first, then its counterparty. Each is labelled like the row that opens it,
// and opens its own scope.
export const scopePath = Effect.fn("scopePath")(function* (
  nodes: readonly CategoryNode[],
  { category, counterparty }: Scope,
) {
  const sql = yield* PgClient.PgClient;
  const path: ScopeCrumb[] = [];
  if (category.kind === "category" || category.kind === "unspecified") {
    const lineage = categoryPath(nodes, category.id);
    const open = lineage.at(-1);
    if (!open) return yield* new FinanceError({ kind: "notFound", message: "Category not found." });
    for (const node of lineage)
      path.push({
        label: node.name,
        opens: { category: { kind: "category", id: node.id }, counterparty: allCounterparties },
      });
    if (category.kind === "unspecified")
      path.push({
        label: unspecifiedLabel(open.name),
        opens: { category, counterparty: allCounterparties },
      });
  }
  if (category.kind === "uncategorised")
    path.push({ label: uncategorisedLabel, opens: { category, counterparty: allCounterparties } });
  if (counterparty.kind === "unidentified")
    path.push({ label: unidentifiedLabel, opens: { category, counterparty } });
  if (counterparty.kind === "counterparty") {
    const [row] = yield* sql`SELECT name FROM counterparties WHERE id = ${counterparty.id}`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ name: Schema.String }))),
      ),
    );
    if (!row)
      return yield* new FinanceError({ kind: "notFound", message: "Counterparty not found." });
    path.push({ label: row.name, opens: { category, counterparty } });
  }
  return path;
});
