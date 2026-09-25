import type { RecordLink } from "@repo/contracts/analyst";
import {
  AllocationRole,
  type CalendarDate,
  CategorySource,
  Correction,
  CounterpartyChangeKind,
  CounterpartyId,
  CounterpartySource,
  CountedCursor,
  EventId,
  FinanceError,
  type FinancialEvent,
  FinancialRole,
  type Instant,
  ListCountedLedger,
  ListPostings,
  LedgerRow,
  type Money,
  MonthsSelection,
  PostingCursor,
  PostingId,
  PostingInput,
  type ReferenceData,
  RoleSource,
} from "@repo/contracts/finance";
import { calendarDateIn, dateLabel, financialRoleLabels, periodLabel } from "@repo/finance";
import type { Api } from "@repo/infra/api";
import { Array as Arr, DateTime, Effect, Schema, Struct } from "effect";
import { Tool } from "effect/unstable/ai";

import {
  arrived,
  cite,
  citeRecord,
  count,
  FigureView,
  money,
  type ReadBasis,
} from "../evidence/present.ts";
import { TurnEvidence } from "../evidence/service.ts";
import { coverageOf } from "./coverage.ts";

const transactionLink = (postingId: typeof PostingId.Type) =>
  ({ kind: "transaction", postingId }) satisfies RecordLink;

// A transaction as the answer names it: who it was with and the day the bank posted it.
// It never quotes what the bank printed, which an earlier answer would show the model.
const transactionLabel = (counterparty: string | null, postedOn: CalendarDate) =>
  `${counterparty ?? "a transaction"} on ${dateLabel(postedOn)}`;

// What a transaction means, and who or what set each part: you, a rule, the bank's
// description, the counterparty's default, or a link to another transaction.
const Meaning = Schema.Struct({
  role: FinancialRole,
  roleSetBy: Schema.NullOr(RoleSource),
  counterparty: Schema.NullOr(Schema.String),
  counterpartySetBy: Schema.NullOr(CounterpartySource),
  // The day of the purchase, when you set one apart from the day the bank posted it.
  purchaseOn: Schema.NullOr(Schema.String),
  allocations: Schema.Array(
    Schema.Struct({
      amount: FigureView,
      role: AllocationRole,
      category: Schema.NullOr(Schema.String),
      categorySetBy: Schema.NullOr(CategorySource),
      // Part of a purchase that is not your spending, such as a work expense.
      nonPersonal: Schema.Boolean,
      tags: Schema.Array(Schema.String),
      personalEvents: Schema.Array(Schema.String),
    }),
  ),
});

const lookup = <Id extends string>(
  rows: ReadonlyArray<{ readonly id: Id; readonly name: string }>,
) => {
  const names = new Map(rows.map((row) => [row.id, row.name]));
  return (id: Id) => names.get(id) ?? null;
};
// `counterparties` can add names the reference data no longer holds.
const namesIn = (
  data: typeof ReferenceData.Type,
  counterparties: ReadonlyArray<{
    readonly id: typeof CounterpartyId.Type;
    readonly name: string;
  }> = [],
) => ({
  category: lookup(data.categories),
  counterparty: lookup([...counterparties, ...data.counterparties]),
  tag: lookup(data.tags),
  personalEvent: lookup(data.personalEvents),
});
type Names = ReturnType<typeof namesIn>;

const presentMeaning = Effect.fnUntraced(function* (
  event: FinancialEvent,
  names: Names,
  subject: string,
) {
  const read = { calculatedAt: yield* arrived, placed: null } satisfies ReadBasis;
  const records = transactionLink(event.primaryPostingId);
  const allocations = event.allocations.map((allocation) => ({
    allocation,
    category: allocation.categoryId === null ? null : names.category(allocation.categoryId),
    tags: allocation.tagIds.flatMap((id) => names.tag(id) ?? []),
    personalEvents: allocation.personalEventIds.flatMap((id) => names.personalEvent(id) ?? []),
  }));
  const counterparty =
    event.counterpartyId === null ? null : names.counterparty(event.counterpartyId);
  yield* (yield* TurnEvidence).names([
    counterparty,
    ...allocations.flatMap((item) => [item.category, ...item.tags, ...item.personalEvents]),
  ]);
  return {
    role: event.kind,
    roleSetBy: event.roleSource,
    counterparty,
    counterpartySetBy: event.counterpartySource,
    purchaseOn: event.purchaseOn === null ? null : dateLabel(event.purchaseOn),
    allocations: yield* Effect.forEach(
      allocations,
      Effect.fnUntraced(function* ({ allocation, category, tags, personalEvents }) {
        return {
          amount: yield* cite(
            read,
            `${subject}, ${category ?? financialRoleLabels[allocation.role]}`,
            money(allocation.amount),
            records,
          ),
          role: allocation.role,
          category,
          categorySetBy: allocation.categorySource,
          nonPersonal: allocation.nonPersonal,
          tags,
          personalEvents,
        };
      }),
    ),
  };
});

// `counted` is what a listed record adds to the measure it was listed for, on the date
// the measure places it.
const presentRow = Effect.fnUntraced(function* (
  row: LedgerRow,
  counted: {
    readonly read: ReadBasis;
    readonly on: CalendarDate;
    readonly amount: Money;
    readonly measure: string;
  } | null,
) {
  const name = transactionLabel(row.counterpartyName, row.postedOn);
  const records = transactionLink(row.id);
  yield* (yield* TurnEvidence).names([row.accountLabel, row.counterpartyName, row.categoryName]);
  return {
    transaction: yield* citeRecord(name, records),
    postingId: row.id,
    eventId: row.eventId,
    on: dateLabel(counted?.on ?? row.postedOn),
    postedOn: dateLabel(row.postedOn),
    account: row.accountLabel,
    bankDescription: row.description,
    counterparty: row.counterpartyName,
    counterpartyId: row.counterpartyId,
    category: row.categoryName,
    role: row.role,
    setBy: row.assignedBy,
    split: row.split,
    question: row.question,
    amount: yield* cite(
      { calculatedAt: yield* arrived, placed: null },
      name,
      money(row.amount),
      records,
    ),
    counted:
      counted === null
        ? null
        : yield* cite(
            counted.read,
            `${name}, counted in ${counted.measure}`,
            money(counted.amount),
            records,
          ),
  };
});

export const ListTransactions = Tool.make("ListTransactions", {
  description:
    "One page of transactions. `counted` lists the records behind a measure's scope over " +
    "whole months, such as a flow stream or a spending row, each with what it adds to the " +
    "measure and dated as spending dates it. `ledger` lists postings newest first, dated as " +
    "the bank posted them and narrowed by the ledger's filters. Each amount is one " +
    "transaction's; read totals with ReadFlow or ReadSpending. Pass a page's `nextCursor` " +
    "back as `cursor` for the next page.",
  parameters: Schema.Struct({
    list: Schema.Union([
      Schema.Struct({
        kind: Schema.Literal("counted"),
        ...Struct.omit(ListCountedLedger.fields, ["period", "basis", "currency"]),
        period: MonthsSelection,
      }),
      Schema.Struct({ kind: Schema.Literal("ledger"), ...ListPostings.fields }),
    ]),
  }),
  success: Schema.Struct({
    title: Schema.String,
    rows: Schema.Array(
      Schema.Struct({
        transaction: Schema.String,
        postingId: PostingId,
        eventId: Schema.NullOr(EventId),
        // The day the list places it on: its spending date when counted, otherwise the day
        // the bank posted it.
        on: Schema.String,
        postedOn: Schema.String,
        account: Schema.String,
        bankDescription: Schema.String,
        counterparty: Schema.NullOr(Schema.String),
        counterpartyId: Schema.NullOr(CounterpartyId),
        category: Schema.NullOr(Schema.String),
        role: Schema.NullOr(FinancialRole),
        setBy: LedgerRow.fields.assignedBy,
        split: Schema.Boolean,
        // Whether an open question covers it.
        question: Schema.Boolean,
        amount: FigureView,
        // What it adds to the measure, signed as the bank booked it. Null in the ledger.
        counted: Schema.NullOr(FigureView),
      }),
    ),
    nextCursor: Schema.NullOr(Schema.Union([CountedCursor, PostingCursor])),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const listTransactions = (
  api: Pick<Api, "listCountedLedger" | "listLedger" | "getCoverage">,
) =>
  Effect.fn("ListTransactions")(function* ({ list }: Tool.Parameters<typeof ListTransactions>) {
    const evidence = yield* TurnEvidence;
    // A list with more pages shows only its first rows, which the screen shows in full.
    const listed = Effect.fnUntraced(function* (
      title: string,
      records: RecordLink,
      shown: number,
      more: boolean,
    ) {
      yield* evidence.step({ label: `Listing ${title}`, records });
      if (more) yield* evidence.limit({ kind: "partialList", shown, records });
    });
    if (list.kind === "counted") {
      const [page, coverage] = yield* Effect.all(
        [
          api.listCountedLedger({
            ...Struct.omit(list, ["kind"]),
            basis: "spending",
            currency: evidence.currency,
          }),
          coverageOf(api, list.period),
        ],
        { concurrency: "unbounded" },
      );
      const title = `the records behind ${page.label} in ${periodLabel(page.period)}`;
      const read = { calculatedAt: page.calculatedAt, placed: coverage } satisfies ReadBasis;
      yield* evidence.names([page.label, ...page.path.map((crumb) => crumb.label)]);
      yield* listed(
        title,
        { kind: "countedLedger", ...Struct.pick(list, ["scope", "period", "filter"]) },
        page.rows.length,
        page.nextCursor !== null,
      );
      return {
        title,
        rows: yield* Effect.forEach(page.rows, (row) =>
          presentRow(row, { read, on: row.on, amount: row.counted, measure: page.label }),
        ),
        nextCursor: page.nextCursor,
      };
    }
    const page = yield* api.listLedger(Struct.omit(list, ["kind"]));
    const title = "transactions in the ledger";
    yield* listed(
      title,
      { kind: "postingLedger", filter: list.filter },
      page.rows.length,
      page.nextCursor !== null,
    );
    return {
      title,
      rows: yield* Effect.forEach(page.rows, (row) => presentRow(row, null)),
      nextCursor: page.nextCursor,
    };
  });

// A posting, the event it belongs to, and the names that event's meaning refers to.
const readPosting = Effect.fnUntraced(function* (
  api: Pick<Api, "getPosting" | "getEventForPosting" | "getReferenceData">,
  postingId: typeof PostingId.Type,
) {
  const [detail, event, reference] = yield* Effect.all(
    [api.getPosting({ postingId }), api.getEventForPosting({ postingId }), api.getReferenceData()],
    { concurrency: "unbounded" },
  );
  const names = namesIn(reference);
  const counterpartyId = event?.counterpartyId ?? null;
  const counterparty = counterpartyId === null ? null : names.counterparty(counterpartyId);
  return {
    detail,
    event,
    reference,
    names,
    name: transactionLabel(counterparty, detail.posting.postedOn),
  };
});

export const ReadTransaction = Tool.make("ReadTransaction", {
  description:
    "One transaction: what the bank printed, the account, what it means and who set each " +
    "part of that, how it splits, and the files it was read from.",
  parameters: PostingInput,
  success: Schema.Struct({
    transaction: Schema.String,
    eventId: Schema.NullOr(EventId),
    postedOn: Schema.String,
    // The day the money moved, when the bank printed one apart from the posting day.
    valueOn: Schema.NullOr(Schema.String),
    account: Schema.String,
    amount: FigureView,
    // The amount in the currency of the purchase, before the bank converted it.
    foreignAmount: Schema.NullOr(FigureView),
    bankDescription: Schema.String,
    counterpartyText: Schema.NullOr(Schema.String),
    // Null while the transaction belongs to no event.
    meaning: Schema.NullOr(Meaning),
    files: Schema.Array(Schema.String),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readTransaction = (
  api: Pick<Api, "getPosting" | "getEventForPosting" | "getReferenceData">,
) =>
  Effect.fn("ReadTransaction")(function* ({ postingId }: Tool.Parameters<typeof ReadTransaction>) {
    const evidence = yield* TurnEvidence;
    const { detail, event, names, name } = yield* readPosting(api, postingId);
    const { posting } = detail;
    const records = transactionLink(postingId);
    const read = { calculatedAt: yield* arrived, placed: null } satisfies ReadBasis;
    yield* evidence.step({ label: `Reading ${name}`, records });
    yield* evidence.names([posting.accountLabel]);
    return {
      transaction: yield* citeRecord(name, records),
      eventId: event?.id ?? null,
      postedOn: dateLabel(posting.postedOn),
      valueOn: posting.valueOn === null ? null : dateLabel(posting.valueOn),
      account: posting.accountLabel,
      amount: yield* cite(read, name, money(posting.amount), records),
      foreignAmount:
        posting.originalMoney === null
          ? null
          : yield* cite(read, `${name}, before conversion`, money(posting.originalMoney), records),
      bankDescription: posting.description,
      counterpartyText: detail.descriptor?.counterpartyText ?? null,
      meaning: event === null ? null : yield* presentMeaning(event, names, name),
      files: Arr.dedupe(detail.evidence.map((item) => item.fileName)),
    };
  });

export const ReadHistory = Tool.make("ReadHistory", {
  description:
    "What changed one transaction's meaning, newest first: your corrections and their " +
    "undos, and changes to counterparties that reached it.",
  parameters: PostingInput,
  success: Schema.Struct({
    entries: Schema.Array(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literal("correction"),
          on: Schema.String,
          action: Correction.fields.action,
          // What the correction set: the role, purchase date, and allocations, or the
          // counterparty.
          changed: Correction.fields.change,
          before: Meaning,
          after: Meaning,
        }),
        Schema.Struct({
          kind: Schema.Literal("counterpartyChange"),
          on: Schema.String,
          change: CounterpartyChangeKind,
          counterparties: Schema.Array(Schema.String),
          // How many transactions the change gave a new meaning.
          transactions: FigureView,
        }),
      ]),
    ),
  }),
  failure: FinanceError,
  failureMode: "return",
  dependencies: [TurnEvidence],
});

export const readHistory = (
  api: Pick<Api, "getPosting" | "getEventForPosting" | "getEventHistory" | "getReferenceData">,
) =>
  Effect.fn("ReadHistory")(function* ({ postingId }: Tool.Parameters<typeof ReadHistory>) {
    const evidence = yield* TurnEvidence;
    const { event, reference, name } = yield* readPosting(api, postingId);
    const records = transactionLink(postingId);
    yield* evidence.step({ label: `Reading the history of ${name}`, records });
    if (event === null) return { entries: [] };
    const history = yield* api.getEventHistory({ eventId: event.id });
    const names = namesIn(reference, history.names);
    const read = { calculatedAt: yield* arrived, placed: null } satisfies ReadBasis;
    const on = (at: Instant) =>
      dateLabel(calendarDateIn(DateTime.makeUnsafe(at), evidence.timezone));
    return {
      entries: yield* Effect.forEach(
        history.entries,
        Effect.fnUntraced(function* (entry) {
          if (entry.kind === "correction") {
            const { correction } = entry;
            return {
              kind: "correction" as const,
              on: on(correction.createdAt),
              action: correction.action,
              changed: correction.change,
              before: yield* presentMeaning(
                correction.prior,
                names,
                `${name}, before ${on(correction.createdAt)}`,
              ),
              after: yield* presentMeaning(
                correction.accepted,
                names,
                `${name}, from ${on(correction.createdAt)}`,
              ),
            };
          }
          const { change } = entry;
          const counterparties = change.subjects.map((subject) => subject.name);
          yield* evidence.names(counterparties);
          return {
            kind: "counterpartyChange" as const,
            on: on(change.createdAt),
            change: change.kind,
            counterparties,
            transactions: yield* cite(
              read,
              `${name}, transactions the change on ${on(change.createdAt)} reached`,
              count(change.eventCount, "transaction"),
              records,
            ),
          };
        }),
      ),
    };
  });
