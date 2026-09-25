import type { RecordLink } from "@repo/contracts/analyst";
import {
  AccountKind,
  CategoryId,
  CategoryTree,
  FinanceError,
  Import,
  ListImports,
  MonthsSelection,
  PersonalEventId,
  TagId,
} from "@repo/contracts/finance";
import { dateLabel, periodLabel } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Effect, Option, Schema, Stream } from "effect";
import { Tool } from "effect/unstable/ai";

import { citeRecord } from "../evidence/present.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { coverageOf } from "./coverage.ts";

export const ReadCategories = Tool.make("ReadCategories", {
  description:
    "Your spending and income categories with the category each sits under, your tags, and " +
    "your personal events with their dates, each with the ID that narrows ReadSpending and " +
    "ListTransactions to it.",
  success: Schema.Struct({
    categories: Schema.Array(
      Schema.Struct({
        id: CategoryId,
        name: Schema.String,
        parent: Schema.NullOr(Schema.String),
        tree: CategoryTree,
        // An archived category takes no new transactions, but its old ones keep it.
        archived: Schema.Boolean,
      }),
    ),
    tags: Schema.Array(Schema.Struct({ id: TagId, name: Schema.String })),
    personalEvents: Schema.Array(
      Schema.Struct({
        id: PersonalEventId,
        name: Schema.String,
        from: Schema.String,
        to: Schema.String,
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readCategories = (api: Pick<Api, "getReferenceData">) =>
  Effect.fn("ReadCategories")(function* () {
    const evidence = yield* TurnEvidence;
    const reference = yield* api.getReferenceData();
    const names = new Map(reference.categories.map((row) => [row.id, row.name]));
    yield* evidence.step({ label: "Reading categories, tags, and personal events", records: null });
    yield* evidence.names(
      [...reference.categories, ...reference.tags, ...reference.personalEvents].map(
        (row) => row.name,
      ),
    );
    return {
      categories: reference.categories.map((row) => ({
        id: row.id,
        name: row.name,
        parent: row.parentId === null ? null : (names.get(row.parentId) ?? null),
        tree: row.tree,
        archived: row.archived,
      })),
      tags: reference.tags.map(({ id, name }) => ({ id, name })),
      personalEvents: reference.personalEvents.map((row) => ({
        id: row.id,
        name: row.name,
        from: dateLabel(row.startOn),
        to: dateLabel(row.endOn),
      })),
    };
  });

export const ReadCoverage = Tool.make("ReadCoverage", {
  description:
    "Which days of whole months each account has no records for, and the files whose " +
    "import failed or waits for review. Read it before saying a period's figures are " +
    "complete.",
  parameters: Schema.Struct({ period: MonthsSelection }),
  success: Schema.Struct({
    period: Schema.String,
    sources: Schema.String,
    accounts: Schema.Array(
      Schema.Struct({
        account: Schema.String,
        kind: AccountKind,
        missing: Schema.Array(Schema.String),
      }),
    ),
    imports: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        status: Import.fields.status.pick(["needs_review", "failed"]),
        problem: Schema.NullOr(Schema.String),
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readCoverage = (api: Pick<Api, "getCoverage" | "listImports">) =>
  Effect.fn("ReadCoverage")(function* ({ period }: Tool.Parameters<typeof ReadCoverage>) {
    const evidence = yield* TurnEvidence;
    const [coverage, imports] = yield* Effect.all(
      [
        coverageOf(api, period),
        // Every page, because a file that failed long ago still leaves its days missing.
        Stream.paginate(
          {} satisfies typeof ListImports.Type,
          Effect.fnUntraced(function* (input) {
            const page = yield* api.listImports(input);
            return [
              page.rows.flatMap((row) =>
                row.status === "failed" || row.status === "needs_review"
                  ? [
                      {
                        file: row.fileName,
                        status: row.status,
                        problem: row.failure?.message ?? null,
                      },
                    ]
                  : [],
              ),
              Option.map(Option.fromNullOr(page.nextCursor), (cursor) => ({ cursor })),
            ] as const;
          }),
        ).pipe(Stream.runCollect),
      ],
      { concurrency: "unbounded" },
    );
    const label = periodLabel(coverage.period);
    const records = { kind: "sources" } satisfies RecordLink;
    yield* evidence.step({ label: `Checking the records for ${label}`, records });
    yield* evidence.check(coverage);
    return {
      period: label,
      sources: yield* citeRecord("Sources", records),
      accounts: coverage.accounts.map((item) => ({
        account: item.account.label,
        kind: item.account.kind,
        missing: item.missing.map(periodLabel),
      })),
      imports,
    };
  });
