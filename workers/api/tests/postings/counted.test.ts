import { PgClient } from "@effect/sql-pg";
import {
  CalendarDate,
  CommandId,
  type CountedScope,
  CounterpartyId,
  type DateBasis,
  TagId,
  YearMonth,
} from "@repo/contracts/finance";
import { Array as Arr, Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { Accounts } from "../../src/accounts/service.ts";
import { Flows } from "../../src/analysis/flows.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Publication } from "../../src/imports/publication.ts";
import { Postings } from "../../src/postings/service.ts";
import { References } from "../../src/references/service.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { applicationTest } from "../support/application.ts";
import { parsedRows, reset, source } from "../support/fixtures.ts";
import { activeEvent, categoryId, populate } from "../support/populated.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const month = (value: string) =>
  ({ kind: "months", from: YearMonth.make(value), to: YearMonth.make(value) }) as const;
const scope = (measure: CountedScope["measure"], category: CountedScope["category"]) => ({
  measure,
  category,
  counterparty: { kind: "all" } as const,
});
const counted = Effect.fn(function* (
  countedScope: CountedScope,
  selection: string,
  basis: typeof DateBasis.Type = "spending",
) {
  return yield* (yield* Postings).counted({
    scope: countedScope,
    period: month(selection),
    basis,
    currency: "AUD",
    filter: {},
  });
});
test(
  "every stream in the populated months totals what its counted ledger lists",
  Effect.gen(function* () {
    yield* populate;
    const flows = yield* Flows;
    const opened: string[] = [];
    for (const selection of ["2026-07", "2026-08"])
      for (const basis of ["spending", "posted"] as const) {
        const flow = yield* flows.period({
          period: month(selection),
          comparison: { kind: "previous" },
          basis,
          currency: "AUD",
        });
        const sides = [
          { streams: flow.outflows, sign: -1n },
          { streams: flow.inflows, sign: 1n },
        ];
        for (const { streams, sign } of sides)
          for (const stream of streams) {
            const page = yield* counted(stream.scope, selection, basis);
            expect(page.label).toBe(stream.label);
            expect(page.total).toEqual(stream.amount);
            expect(page.nextCursor).toBeNull();
            page.parts.forEach((part, index) => {
              const listed = page.rows
                .filter((row) => row.part === index)
                .reduce((total, row) => total + row.counted.minor, 0n);
              expect(listed).toBe(sign * part.amount.minor);
            });
            opened.push(`${selection} ${basis} ${stream.key}`);
          }
      }
    expect(opened).toContain("2026-07 spending loanPrincipal");
    expect(opened).toContain("2026-08 posted unresolvedIn");
  }).pipe(Effect.provide(services)),
);

test(
  "loan principal lists the repayment from the account the cash left, less the interest charged on the loan",
  Effect.gen(function* () {
    yield* populate;
    // Paired from the loan side, the repayment's primary posting is the loan's credit.
    const relationships = yield* Relationships;
    const change = {
      kind: "linkMovement",
      eventId: (yield* activeEvent("Loan Repayment")).id,
      movementKind: "loanPayment",
      counterpart: {
        kind: "event",
        eventId: (yield* activeEvent("Loan Repayment LN REPAY 123456789")).id,
      },
    } as const;
    yield* relationships.apply({
      commandId: yield* commandId,
      change,
      expectedVersions: (yield* relationships.preview({ change })).expectedVersions,
    });
    const page = yield* counted(scope("loanPrincipal", { kind: "all" }), "2026-07");
    expect(page).toMatchObject({
      label: "Loan principal",
      total: { minor: 110000n },
      parts: [
        { label: "Repayments", sign: "add", amount: { minor: 390000n }, postings: 1 },
        {
          label: "Interest and fees on your loans",
          sign: "less",
          amount: { minor: 280000n },
          postings: 1,
        },
      ],
    });
    expect(
      page.rows.map((row) => [row.part, row.description, row.accountLabel, row.counted.minor]),
    ).toEqual([
      [0, "Loan Repayment LN REPAY 123456789", "Everyday", -390000n],
      [1, "Interest charged", "Home loan", -280000n],
    ]);
    const flow = yield* (yield* Flows).period({
      period: month("2026-07"),
      comparison: { kind: "previous" },
      basis: "spending",
      currency: "AUD",
    });
    expect(flow.outflows.find((stream) => stream.kind === "loanPrincipal")?.amount.minor).toBe(
      110000n,
    );
  }).pipe(Effect.provide(services)),
);

test(
  "a partly repaid dinner is listed once at its cost, with the repayment taken off on the dinner's date",
  Effect.gen(function* () {
    yield* populate;
    const page = yield* counted(
      scope("spending", { kind: "category", id: yield* categoryId("food.dining-out") }),
      "2026-07",
    );
    expect(page).toMatchObject({
      label: "Dining out",
      total: { minor: 10000n },
      parts: [{ postings: 2 }],
    });
    expect(
      page.rows
        .toSorted((a, b) => a.description.localeCompare(b.description))
        .map((row) => [row.description, row.counted.minor, row.amount.minor, row.on, row.postedOn]),
    ).toEqual([
      ["Dinner Place SYDNEY AU Card xx1234", -30000n, -30000n, "2026-07-04", "2026-07-04"],
      ["Fast Transfer From John Citizen dinner split", 20000n, 20000n, "2026-07-04", "2026-07-06"],
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a purchase made before it posted is listed in the month it was made",
  Effect.gen(function* () {
    yield* populate;
    const groceries = yield* activeEvent("WOOLWORTHS 1234 SYDNEY AU Card xx1234");
    yield* (yield* Corrections).apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: groceries.id, version: groceries.version }],
      change: {
        eventId: groceries.id,
        kind: groceries.kind,
        purchaseOn: CalendarDate.make("2026-06-30"),
        allocations: groceries.allocations,
      },
    });
    const spending = scope("spending", { kind: "all" });
    const listed = (page: Effect.Success<ReturnType<typeof counted>>) =>
      page.rows
        .filter((row) => row.description === "WOOLWORTHS 1234 SYDNEY AU Card xx1234")
        .map((row) => [row.on, row.postedOn, row.counted.minor]);
    expect(listed(yield* counted(spending, "2026-06"))).toEqual([
      ["2026-06-30", "2026-07-03", -8450n],
    ]);
    expect(listed(yield* counted(spending, "2026-07"))).toEqual([]);
    expect(listed(yield* counted(spending, "2026-07", "posted"))).toEqual([
      ["2026-07-03", "2026-07-03", -8450n],
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a split purchase counts only the part in the scope's category or carrying the chosen tag",
  Effect.gen(function* () {
    yield* populate;
    const bigShop = (page: Effect.Success<ReturnType<typeof counted>>) =>
      page.rows
        .filter((row) => row.description === "BIG SHOP SYDNEY AU")
        .map((row) => [row.counted.minor, row.amount.minor]);
    const clothing = yield* categoryId("shopping.clothing");
    expect(
      bigShop(yield* counted(scope("spending", { kind: "category", id: clothing }), "2026-07")),
    ).toEqual([[-8000n, -12000n]]);
    const shopping = scope("spending", {
      kind: "category",
      id: yield* categoryId("shopping"),
    });
    expect(bigShop(yield* counted(shopping, "2026-07"))).toEqual([[-12000n, -12000n]]);

    yield* (yield* References).save({
      commandId: yield* commandId,
      record: { kind: "tag", target: { kind: "create" }, name: "Winter wardrobe" },
    });
    const sql = yield* PgClient.PgClient;
    const [tag] = yield* sql`SELECT id FROM tags WHERE name = 'Winter wardrobe'`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ id: TagId })]))),
    );
    const split = yield* activeEvent("BIG SHOP SYDNEY AU");
    yield* (yield* Corrections).apply({
      commandId: yield* commandId,
      expectedVersions: [{ eventId: split.id, version: split.version }],
      change: {
        eventId: split.id,
        kind: split.kind,
        purchaseOn: split.purchaseOn,
        allocations: Arr.map(split.allocations, (allocation) =>
          allocation.categoryId === clothing ? { ...allocation, tagIds: [tag.id] } : allocation,
        ),
      },
    });
    const tagged = yield* (yield* Postings).counted({
      scope: shopping,
      period: month("2026-07"),
      basis: "spending",
      currency: "AUD",
      filter: { tagId: tag.id },
    });
    expect(bigShop(tagged)).toEqual([[-8000n, -12000n]]);
    expect(tagged.total.minor).toBe(8000n);
  }).pipe(Effect.provide(services)),
);

test(
  "a posting filter counts only the records it keeps",
  Effect.gen(function* () {
    yield* populate;
    const page = yield* (yield* Postings).counted({
      scope: scope("spending", { kind: "category", id: yield* categoryId("food.dining-out") }),
      period: month("2026-07"),
      basis: "spending",
      currency: "AUD",
      filter: { description: "John" },
    });
    expect(page.rows.map((row) => [row.description, row.counted.minor])).toEqual([
      ["Fast Transfer From John Citizen dinner split", 20000n],
    ]);
    expect(page.total.minor).toBe(-20000n);
    expect(page.parts.map((part) => part.postings)).toEqual([1]);
  }).pipe(Effect.provide(services)),
);

test(
  "a scope narrows to what sits on the category itself, to one counterparty, or to none",
  Effect.gen(function* () {
    yield* populate;
    const sql = yield* PgClient.PgClient;
    const [woolworths] = yield* sql`SELECT id FROM counterparties WHERE name = 'Woolworths'`.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ id: CounterpartyId })])),
      ),
    );
    const food = yield* categoryId("food");
    const inFood = (counterparty: CountedScope["counterparty"]) =>
      counted(
        { measure: "spending", category: { kind: "category", id: food }, counterparty },
        "2026-07",
      );
    const listed = (page: Effect.Success<ReturnType<typeof counted>>) =>
      page.rows
        .toSorted((a, b) => a.description.localeCompare(b.description))
        .map((row) => [row.description, row.counted.minor]);

    const unidentified = yield* inFood({ kind: "unidentified" });
    expect(listed(unidentified)).toEqual([
      ["Dinner Place SYDNEY AU Card xx1234", -30000n],
      ["Fast Transfer From John Citizen dinner split", 20000n],
    ]);
    expect(unidentified.total.minor).toBe(10000n);
    const groceries = yield* inFood({ kind: "counterparty", id: woolworths.id });
    expect(listed(groceries)).toEqual([["WOOLWORTHS 1234 SYDNEY AU Card xx1234", -8450n]]);
    expect(groceries.total.minor).toBe(8450n);

    const shopping = yield* counted(
      scope("spending", { kind: "unspecified", id: yield* categoryId("shopping") }),
      "2026-07",
    );
    expect(shopping).toMatchObject({
      label: "Shopping, unspecified",
      rows: [],
      total: { minor: 0n },
    });
  }).pipe(Effect.provide(services)),
);

test(
  "pages of a stream with two parts neither skip nor repeat a record",
  Effect.gen(function* () {
    yield* reset;
    const accounts = yield* Accounts;
    const open = Effect.fn(function* (kind: "deposit" | "loan", label: string) {
      return yield* accounts.create({
        commandId: yield* commandId,
        label,
        kind,
        institution: "commbank",
        currency: "AUD",
      });
    });
    const publish = Effect.fn(function* (
      accountId: Parameters<typeof source>[0],
      rows: Parameters<typeof parsedRows>[0],
    ) {
      const file = yield* source(accountId);
      yield* (yield* Publication).publish({ ...parsedRows(rows), importId: file.importId });
    });
    const everyday = yield* open("deposit", "Everyday");
    const loan = yield* open("loan", "Home loan");
    yield* publish(
      everyday.id,
      Array.from({ length: 55 }, (_, index) => ({
        description: "Loan Repayment LN REPAY 123456789",
        postedOn: "2026-07-10",
        minor: -BigInt(1000 + index),
      })),
    );
    yield* publish(
      loan.id,
      Array.from({ length: 10 }, () => ({
        description: "Interest charged",
        postedOn: "2026-07-20",
        minor: -100n,
      })),
    );

    const loanPrincipal = scope("loanPrincipal", { kind: "all" });
    const first = yield* counted(loanPrincipal, "2026-07");
    expect(first.rows).toHaveLength(50);
    if (!first.nextCursor) return yield* Effect.die("Expected a second page");
    const second = yield* (yield* Postings).counted({
      scope: loanPrincipal,
      period: month("2026-07"),
      basis: "spending",
      currency: "AUD",
      filter: {},
      cursor: first.nextCursor,
    });
    expect(second.nextCursor).toBeNull();
    const rows = [...first.rows, ...second.rows];
    expect(rows.map((row) => row.part)).toEqual([
      ...Array.from({ length: 55 }, () => 0),
      ...Array.from({ length: 10 }, () => 1),
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(65);
    expect(second.parts.map((part) => [part.amount.minor, part.postings])).toEqual([
      [56485n, 55],
      [1000n, 10],
    ]);
    expect(second.total.minor).toBe(55485n);
  }).pipe(Effect.provide(services)),
);
