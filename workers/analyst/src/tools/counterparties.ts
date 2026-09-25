import type { RecordLink } from "@repo/contracts/analyst";
import {
  AssignmentAuthor,
  AssignmentStatus,
  CounterpartyId,
  CounterpartyInput,
  CounterpartyKind,
  CounterpartyRole,
  CoverageState,
  FinanceError,
  ListCounterparties,
  MonthsSelection,
} from "@repo/contracts/finance";
import { dateLabel, monthLabel, monthsPeriod, periodLabel } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Effect, Schema, Struct } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  arrived,
  cite,
  citeRecord,
  count,
  FigureView,
  money,
  placedBy,
  type ReadBasis,
} from "../evidence/present.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { coverageOf, monthReads } from "./coverage.ts";

// The most counterparties one list shows the model. The screen shows the rest.
const listed = 30;

const counterpartyLink = (counterpartyId: typeof CounterpartyId.Type) =>
  ({ kind: "counterparty", counterpartyId }) satisfies RecordLink;

export const FindCounterparties = Tool.make("FindCounterparties", {
  description:
    "The counterparties money went to (out) or came from (in) over whole months, most " +
    "money first, with what you paid or received and the transactions behind it. `search` " +
    "keeps those whose name, brand, or bank description contains it; leave it empty for " +
    "all of them.",
  parameters: Schema.Struct({
    period: MonthsSelection,
    ...Struct.pick(ListCounterparties.fields, ["search", "direction"]),
  }),
  success: Schema.Struct({
    counterparties: Schema.Array(
      Schema.Struct({
        counterparty: Schema.String,
        counterpartyId: CounterpartyId,
        name: Schema.String,
        kind: CounterpartyKind,
        // A proposed counterparty is the model's guess, waiting for your answer.
        status: AssignmentStatus,
        // What you paid it, or received from it.
        amount: FigureView,
        transactions: FigureView,
        // The last day money moved with it, in any period.
        lastOn: Schema.NullOr(Schema.String),
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const findCounterparties = (api: Pick<Api, "listCounterparties" | "getCoverage">) =>
  Effect.fn("FindCounterparties")(function* ({
    period,
    search,
    direction,
  }: Tool.Parameters<typeof FindCounterparties>) {
    const evidence = yield* TurnEvidence;
    // The list screen reads whole months too.
    const months = monthsPeriod(period.from, period.to);
    const [rows, coverage] = yield* Effect.all(
      [
        api.listCounterparties({ search, direction, currency: evidence.currency, period: months }),
        coverageOf(api, period),
      ],
      { concurrency: "unbounded" },
    );
    const label = periodLabel(months);
    const read = placedBy(coverage);
    const records = { kind: "counterparties", period, direction, search } satisfies RecordLink;
    yield* evidence.step({
      label:
        search === ""
          ? `Listing counterparties for ${label}`
          : `Finding counterparties matching "${search}" for ${label}`,
      records,
    });
    const shown = rows.slice(0, listed);
    if (rows.length > shown.length)
      yield* evidence.limit({ kind: "partialList", shown: shown.length, records });
    yield* evidence.names(shown.map((row) => row.name));
    const moved = direction === "out" ? "paid" : "received";
    return {
      counterparties: yield* Effect.forEach(
        shown,
        Effect.fnUntraced(function* (row) {
          const [amount, transactions] =
            direction === "out" ? [row.outflow, row.outflowEvents] : [row.inflow, row.inflowEvents];
          return {
            counterparty: yield* citeRecord(row.name, counterpartyLink(row.id)),
            counterpartyId: row.id,
            name: row.name,
            kind: row.kind,
            status: row.status,
            amount: yield* cite(read, `${row.name}, ${moved} in ${label}`, money(amount), records),
            transactions: yield* cite(
              read,
              `${row.name}, transactions ${moved} in ${label}`,
              count(transactions, "transaction"),
              records,
            ),
            lastOn: row.lastOn === null ? null : dateLabel(row.lastOn),
          };
        }),
      ),
    };
  });

export const ReadCounterparty = Tool.make("ReadCounterparty", {
  description:
    "One counterparty: its defaults, what you paid it and received from it over all your " +
    "records and by month, the bank descriptions that name it, and the references on " +
    "payments with it.",
  parameters: CounterpartyInput,
  success: Schema.Struct({
    counterparty: Schema.String,
    name: Schema.String,
    kind: CounterpartyKind,
    brand: Schema.NullOr(Schema.String),
    // Whether you or the model named it, and whether it waits for your answer.
    setBy: AssignmentAuthor,
    status: AssignmentStatus,
    defaultRole: Schema.NullOr(CounterpartyRole),
    defaultCategory: Schema.NullOr(Schema.String),
    paid: FigureView,
    received: FigureView,
    transactions: FigureView,
    lastOn: Schema.NullOr(Schema.String),
    descriptions: Schema.Array(
      Schema.Struct({
        bankDescription: Schema.Array(Schema.String),
        status: AssignmentStatus,
        transactions: FigureView,
      }),
    ),
    // Months without records have no figures.
    months: Schema.Array(
      Schema.Struct({
        month: Schema.String,
        records: CoverageState,
        paid: Schema.NullOr(FigureView),
        received: Schema.NullOr(FigureView),
      }),
    ),
    references: Schema.Array(
      Schema.Struct({
        reference: Schema.String,
        transactions: FigureView,
        defaultRole: Schema.NullOr(CounterpartyRole),
        defaultCategory: Schema.NullOr(Schema.String),
      }),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readCounterparty = (
  api: Pick<Api, "getCounterparty" | "getReferenceData" | "getCoverage">,
) =>
  Effect.fn("ReadCounterparty")(function* ({
    counterpartyId,
  }: Tool.Parameters<typeof ReadCounterparty>) {
    const evidence = yield* TurnEvidence;
    const [detail, reference] = yield* Effect.all(
      [api.getCounterparty({ counterpartyId }), api.getReferenceData()],
      { concurrency: "unbounded" },
    );
    const { counterparty } = detail;
    const categories = new Map(reference.categories.map((row) => [row.id, row.name]));
    const categoryName = (id: (typeof counterparty)["defaultCategoryId"]) =>
      id === null ? null : (categories.get(id) ?? null);
    const records = counterpartyLink(counterpartyId);
    // Totals over every record, which no period places.
    const whole = { calculatedAt: yield* arrived, placed: null } satisfies ReadBasis;
    const { name } = counterparty;
    const everything = "in all your records";
    yield* evidence.step({ label: `Reading ${name}`, records });
    const defaultCategory = categoryName(counterparty.defaultCategoryId);
    yield* evidence.names([
      name,
      counterparty.brand,
      defaultCategory,
      ...detail.references.map((reference) => categoryName(reference.defaultCategoryId)),
    ]);
    const byMonth = yield* monthReads(api, detail.months);
    return {
      counterparty: yield* citeRecord(name, records),
      name,
      kind: counterparty.kind,
      brand: counterparty.brand,
      setBy: counterparty.source,
      status: counterparty.status,
      defaultRole: counterparty.defaultRole,
      defaultCategory,
      paid: yield* cite(whole, `${name}, paid ${everything}`, money(counterparty.outflow), records),
      received: yield* cite(
        whole,
        `${name}, received ${everything}`,
        money(counterparty.inflow),
        records,
      ),
      transactions: yield* cite(
        whole,
        `${name}, transactions ${everything}`,
        count(counterparty.eventCount, "transaction"),
        records,
      ),
      lastOn: counterparty.lastOn === null ? null : dateLabel(counterparty.lastOn),
      descriptions: yield* Effect.forEach(
        detail.aliases,
        Effect.fnUntraced(function* (alias) {
          return {
            bankDescription: alias.samples,
            status: alias.status,
            transactions: yield* cite(
              whole,
              `${name}, transactions written as “${alias.samples[0] ?? alias.aliasKey}” ${everything}`,
              count(alias.eventCount, "transaction"),
              records,
            ),
          };
        }),
      ),
      months: yield* Effect.forEach(
        detail.months,
        Effect.fnUntraced(function* (month) {
          const placed = byMonth.get(month.month);
          const label = monthLabel(month.month);
          const figure = (moved: string, amount: typeof month.outflow) =>
            placed === undefined
              ? Effect.succeed(null)
              : cite(placedBy(placed), `${name}, ${moved} in ${label}`, money(amount), records);
          return {
            month: label,
            records: month.coverage,
            paid: yield* figure("paid", month.outflow),
            received: yield* figure("received", month.inflow),
          };
        }),
      ),
      references: yield* Effect.forEach(
        detail.references,
        Effect.fnUntraced(function* (reference) {
          return {
            reference: reference.sample,
            transactions: yield* cite(
              whole,
              `${name}, payments marked “${reference.sample}” ${everything}`,
              count(reference.eventCount, "transaction"),
              records,
            ),
            defaultRole: reference.defaultRole,
            defaultCategory: categoryName(reference.defaultCategoryId),
          };
        }),
      ),
    };
  });
