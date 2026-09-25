import { PgClient } from "@effect/sql-pg";
import {
  CalendarDate,
  type CategoryId,
  CommandId,
  type CountedFilter,
  type DateBasis,
  PersonalEventId,
  type Scope,
  type SpendingBreakdown,
  YearMonth,
} from "@repo/contracts/finance";
import { Array as Arr, Crypto, Effect, Schema } from "effect";
import { expect } from "vitest";

import { Flows } from "../../src/analysis/flows.ts";
import { Spending } from "../../src/analysis/spending.ts";
import { Corrections } from "../../src/events/corrections.ts";
import { Postings } from "../../src/postings/service.ts";
import { References } from "../../src/references/service.ts";
import { Relationships } from "../../src/relationships/service.ts";
import { applicationTest } from "../support/application.ts";
import { createCounterparty } from "../support/fixtures.ts";
import { activeEvent, categoryId, populate } from "../support/populated.ts";

const { test, services } = applicationTest();
const commandId = Crypto.Crypto.use((crypto) => crypto.randomUUIDv4).pipe(
  Effect.map((id) => CommandId.make(id)),
);
const month = (value: string) =>
  ({ kind: "months", from: YearMonth.make(value), to: YearMonth.make(value) }) as const;
const everything = { category: { kind: "all" }, counterparty: { kind: "all" } } as const;
const categoryScope = (id: typeof CategoryId.Type) => ({ kind: "category", id }) as const;

const breakdown = Effect.fn(function* (
  selection: string,
  scope: Partial<Scope> = {},
  basis: typeof DateBasis.Type = "spending",
) {
  return yield* (yield* Spending).breakdown({
    period: month(selection),
    comparison: { kind: "previous" },
    basis,
    currency: "AUD",
    ...everything,
    ...scope,
  });
});
const records = Effect.fn(function* (
  selection: string,
  scope: Scope,
  filter: typeof CountedFilter.Type = {},
) {
  return yield* (yield* Postings).counted({
    scope: { measure: "spending", ...scope },
    period: month(selection),
    basis: "spending",
    currency: "AUD",
    filter,
  });
});
const amounts = (result: SpendingBreakdown) =>
  result.rows.map((row) => [row.label, row.figures.current.minor, row.figures.previous.minor]);
const listed = (page: Effect.Success<ReturnType<typeof records>>) =>
  page.rows
    .toSorted((a, b) => a.description.localeCompare(b.description))
    .map((row) => [row.description, row.counted.minor, row.on, row.postedOn]);
const rowNamed = Effect.fn(function* (result: SpendingBreakdown, label: string) {
  const row = result.rows.find((item) => item.label === label);
  if (!row) return yield* Effect.die(`Expected a row labelled ${label}`);
  return row;
});
const correctAllocations = Effect.fn(function* (
  description: string,
  change: (
    allocation: Effect.Success<ReturnType<typeof activeEvent>>["allocations"][number],
  ) => Effect.Success<ReturnType<typeof activeEvent>>["allocations"][number],
) {
  const event = yield* activeEvent(description);
  yield* (yield* Corrections).apply({
    commandId: yield* commandId,
    expectedVersions: [{ eventId: event.id, version: event.version }],
    change: {
      eventId: event.id,
      kind: event.kind,
      purchaseOn: event.purchaseOn,
      allocations: Arr.map(event.allocations, change),
    },
  });
});

test(
  "Dining out opens its counterparties, and a counterparty's records add up to its row",
  Effect.gen(function* () {
    yield* populate;
    const dinnerPlace = yield* createCounterparty({ name: "Dinner Place" }, [
      "DINNER PLACE SYDNEY",
    ]);
    const diningOut = categoryScope(yield* categoryId("food.dining-out"));
    const opened = yield* breakdown("2026-07", { category: diningOut });
    expect(opened.level).toBe("counterparties");
    expect(opened.path.map((crumb) => crumb.label)).toEqual(["Food", "Dining out"]);
    // The $300 dinner less the $200 John repaid, which counts against the dinner.
    expect(
      opened.rows.map((row) => [
        row.label,
        row.share,
        row.figures.current.minor,
        row.figures.purchases,
        row.figures.averagePurchase?.minor,
      ]),
    ).toEqual([["Dinner Place", 100, 10000n, 1, 10000n]]);
    const row = yield* rowNamed(opened, "Dinner Place");
    expect(row.opens).toEqual({
      category: diningOut,
      counterparty: { kind: "counterparty", id: dinnerPlace.id },
    });

    const page = yield* records("2026-07", row.opens);
    expect(page.total).toEqual(row.figures.current);
    expect(page.path.map((crumb) => crumb.label)).toEqual(["Food", "Dining out", "Dinner Place"]);
    expect(listed(page)).toEqual([
      ["Dinner Place SYDNEY AU Card xx1234", -30000n, "2026-07-04", "2026-07-04"],
      ["Fast Transfer From John Citizen dinner split", 20000n, "2026-07-04", "2026-07-06"],
    ]);
    const transactions = yield* breakdown("2026-07", row.opens);
    // With no rows to take it from, the level keeps its category's hue.
    expect(transactions).toMatchObject({
      level: "transactions",
      slug: "food.dining-out",
      rows: [],
      figures: { current: { minor: 10000n } },
    });
    expect(transactions.path).toEqual(page.path);
  }).pipe(Effect.provide(services)),
);

test(
  "a refund posted the next month counts in its purchase's month once it is linked",
  Effect.gen(function* () {
    yield* populate;
    const clothing = categoryScope(yield* categoryId("shopping.clothing"));
    yield* createCounterparty({ name: "Myer", defaultCategoryId: clothing.id }, ["MYER SYDNEY"]);
    // The $40 refund of 2 August, then the $120 purchase of 15 July and the $80 of Big
    // Shop's split in July.
    expect(amounts(yield* breakdown("2026-08", { category: clothing }))).toEqual([
      ["Unidentified", 0n, 8000n],
      ["Myer", -4000n, 12000n],
    ]);

    const purchase = yield* activeEvent("MYER SYDNEY AU Card xx1234");
    const refund = yield* activeEvent("Refund Purchase MYER SYDNEY");
    const [cost] = purchase.allocations;
    const [credit] = refund.allocations;
    if (!cost || !credit) return yield* Effect.die("Expected allocations");
    const relationships = yield* Relationships;
    const change = {
      kind: "linkCredit",
      creditAllocationId: credit.id,
      costAllocationId: cost.id,
      amount: { currency: "AUD", minor: 4000n },
    } as const;
    yield* relationships.apply({
      commandId: yield* commandId,
      change,
      expectedVersions: (yield* relationships.preview({ change })).expectedVersions,
    });

    const july = yield* breakdown("2026-07", { category: clothing });
    expect(amounts(july)).toEqual([
      ["Myer", 8000n, 0n],
      ["Unidentified", 8000n, 0n],
    ]);
    expect(amounts(yield* breakdown("2026-08", { category: clothing }))).toEqual([
      ["Myer", 0n, 8000n],
      ["Unidentified", 0n, 8000n],
    ]);
    const myer = yield* rowNamed(july, "Myer");
    const page = yield* records("2026-07", myer.opens);
    expect(listed(page)).toEqual([
      ["MYER SYDNEY AU Card xx1234", -12000n, "2026-07-15", "2026-07-15"],
      ["Refund Purchase MYER SYDNEY", 4000n, "2026-07-15", "2026-08-02"],
    ]);
    expect(page.total).toEqual(myer.figures.current);
    expect((yield* records("2026-08", myer.opens)).rows).toEqual([]);
  }).pipe(Effect.provide(services)),
);

test(
  "a purchase dated before it posted counts on its purchase date in spending and in its records",
  Effect.gen(function* () {
    yield* populate;
    const woolworths = "WOOLWORTHS 1234 SYDNEY AU Card xx1234";
    const groceries = yield* activeEvent(woolworths);
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
    const scope = { category: categoryScope(yield* categoryId("food.groceries")) };
    const june = yield* breakdown("2026-06", scope);
    expect(amounts(june)).toEqual([["Woolworths", 8450n, 0n]]);
    const row = yield* rowNamed(june, "Woolworths");
    const page = yield* records("2026-06", row.opens);
    expect(listed(page)).toEqual([[woolworths, -8450n, "2026-06-30", "2026-07-03"]]);
    expect(page.total).toEqual(row.figures.current);

    expect(amounts(yield* breakdown("2026-07", scope))).toEqual([["Woolworths", 0n, 8450n]]);
    expect((yield* records("2026-07", row.opens)).rows).toEqual([]);
    expect(amounts(yield* breakdown("2026-07", scope, "posted"))).toEqual([
      ["Woolworths", 8450n, 0n],
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a split purchase counts once in its parent and only its part in each subcategory",
  Effect.gen(function* () {
    yield* populate;
    // Big Shop's $120 is $80 of Clothing and $40 of Home and furniture.
    const purchases = (result: SpendingBreakdown) =>
      result.rows.map((row) => [row.label, row.figures.current.minor, row.figures.purchases]);
    const shopping = categoryScope(yield* categoryId("shopping"));
    const everyCategory = yield* breakdown("2026-07");
    expect((yield* rowNamed(everyCategory, "Shopping")).figures).toMatchObject({
      current: { minor: 12000n },
      purchases: 1,
      averagePurchase: { minor: 12000n },
    });
    const opened = yield* breakdown("2026-07", { category: shopping });
    expect(opened.level).toBe("categories");
    expect(opened.figures.purchases).toBe(1);
    expect(purchases(opened)).toEqual([
      ["Clothing", 8000n, 1],
      ["Home and furniture", 4000n, 1],
    ]);

    const clothing = yield* breakdown("2026-07", {
      category: (yield* rowNamed(opened, "Clothing")).opens.category,
    });
    expect(purchases(clothing)).toEqual([["Unidentified", 8000n, 1]]);
    const page = yield* records("2026-07", (yield* rowNamed(clothing, "Unidentified")).opens);
    expect(page.rows.map((row) => [row.description, row.counted.minor, row.amount.minor])).toEqual([
      ["BIG SHOP SYDNEY AU", -8000n, -12000n],
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "rows add up to their scope, and all spending's series is the monthly flow's, even in a month no row spent",
  Effect.gen(function* () {
    yield* populate;
    const july = yield* breakdown("2026-07");
    expect(july.rows.map((row) => [row.label, row.figures.current.minor, row.share])).toEqual([
      ["Housing", 464000n, 92],
      ["Food", 18450n, 4],
      ["Not yet categorised", 12000n, 2],
      ["Shopping", 12000n, 2],
    ]);
    expect(july.figures.current.minor).toBe(506450n);
    expect((yield* rowNamed(july, "Not yet categorised")).opens).toEqual({
      category: { kind: "uncategorised" },
      counterparty: { kind: "all" },
    });
    expect(
      july.months.map((_, index) =>
        july.rows.reduce((sum, row) => sum + (row.months[index]?.minor ?? 0n), 0n),
      ),
    ).toEqual(july.months.map((item) => item.amount.minor));

    // September and August have no spending, so no row is shown, but July is in the series.
    const september = yield* breakdown("2026-09");
    expect(september.rows).toEqual([]);
    expect(september.months.map((item) => item.month)).toEqual([
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
    ]);
    expect(september.months.find((item) => item.month === "2026-07")?.amount.minor).toBe(506450n);
    expect(september.months[0]?.coverage).toBe("missing");
    const monthly = yield* (yield* Flows).monthly({ currency: "AUD" });
    expect(
      september.months
        .filter((item) => monthly.some((flow) => flow.month === item.month))
        .map((item) => [item.month, item.amount, item.coverage]),
    ).toEqual(
      monthly
        .filter((flow) => september.months.some((item) => item.month === flow.month))
        .map((flow) => [flow.month, flow.spending, flow.coverage]),
    );
  }).pipe(Effect.provide(services)),
);

test(
  "spending placed on a category with subcategories has its own row, which opens only that spending",
  Effect.gen(function* () {
    yield* populate;
    const food = yield* categoryId("food");
    yield* correctAllocations("WOOLWORTHS 1234 SYDNEY AU Card xx1234", (allocation) => ({
      ...allocation,
      categoryId: food,
    }));
    // Woolworths' $84.50 sits on Food itself, beside the $100 left of the dinner.
    const opened = yield* breakdown("2026-07", { category: categoryScope(food) });
    expect(amounts(opened)).toEqual([
      ["Dining out", 10000n, 0n],
      ["Food, unspecified", 8450n, 0n],
    ]);
    const own = yield* rowNamed(opened, "Food, unspecified");
    expect(own.opens).toEqual({
      category: { kind: "unspecified", id: food },
      counterparty: { kind: "all" },
    });

    const unspecified = yield* breakdown("2026-07", own.opens);
    expect(unspecified.level).toBe("counterparties");
    expect(unspecified.path.map((crumb) => crumb.label)).toEqual(["Food", "Food, unspecified"]);
    expect(amounts(unspecified)).toEqual([["Woolworths", 8450n, 0n]]);
    const page = yield* records("2026-07", own.opens);
    expect(listed(page)).toEqual([
      ["WOOLWORTHS 1234 SYDNEY AU Card xx1234", -8450n, "2026-07-03", "2026-07-03"],
    ]);
    expect(page.total).toEqual(own.figures.current);
  }).pipe(Effect.provide(services)),
);

test(
  "spending not yet categorised opens its counterparties, including Unidentified",
  Effect.gen(function* () {
    yield* populate;
    yield* createCounterparty({ name: "Myer" }, ["MYER SYDNEY"]);
    yield* correctAllocations("Dinner Place SYDNEY AU Card xx1234", (allocation) => ({
      ...allocation,
      categoryId: null,
      categorySource: null,
    }));
    const uncategorised = yield* breakdown("2026-07", { category: { kind: "uncategorised" } });
    expect(uncategorised.level).toBe("counterparties");
    expect(uncategorised.path.map((crumb) => crumb.label)).toEqual(["Not yet categorised"]);
    expect(amounts(uncategorised)).toEqual([
      ["Myer", 12000n, 0n],
      ["Unidentified", 10000n, 0n],
    ]);
    const unidentified = yield* rowNamed(uncategorised, "Unidentified");
    expect(unidentified.opens).toEqual({
      category: { kind: "uncategorised" },
      counterparty: { kind: "unidentified" },
    });
    const page = yield* records("2026-07", unidentified.opens);
    expect(page).toMatchObject({ label: "Unidentified", total: unidentified.figures.current });
    expect(page.path.map((crumb) => crumb.label)).toEqual(["Not yet categorised", "Unidentified"]);
    expect(listed(page).map(([description]) => description)).toEqual([
      "Dinner Place SYDNEY AU Card xx1234",
      "Fast Transfer From John Citizen dinner split",
    ]);
  }).pipe(Effect.provide(services)),
);

test(
  "a personal event's spending takes off a repayment linked to one of its purchases",
  Effect.gen(function* () {
    yield* populate;
    yield* (yield* References).save({
      commandId: yield* commandId,
      record: {
        kind: "personalEvent",
        target: { kind: "create" },
        name: "Birthday dinner",
        startOn: CalendarDate.make("2026-07-04"),
        endOn: CalendarDate.make("2026-07-04"),
        excludeFromOrdinary: false,
      },
    });
    const sql = yield* PgClient.PgClient;
    const [birthday] =
      yield* sql`SELECT id FROM personal_events WHERE name = 'Birthday dinner'`.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ id: PersonalEventId })])),
        ),
      );
    yield* correctAllocations("Dinner Place SYDNEY AU Card xx1234", (allocation) => ({
      ...allocation,
      personalEventIds: [birthday.id],
    }));
    const event = yield* (yield* Spending).breakdown({
      period: month("2026-07"),
      comparison: { kind: "previous" },
      basis: "spending",
      currency: "AUD",
      ...everything,
      personalEventId: birthday.id,
    });
    // The $300 dinner less John's $200, and none of July's other $4,964.50.
    expect(event.figures).toMatchObject({ current: { minor: 10000n }, purchases: 1 });
    expect(amounts(event)).toEqual([["Food", 10000n, 0n]]);
    const page = yield* records("2026-07", everything, { personalEventId: birthday.id });
    expect(page.total.minor).toBe(10000n);
    expect(listed(page).map(([description, counted]) => [description, counted])).toEqual([
      ["Dinner Place SYDNEY AU Card xx1234", -30000n],
      ["Fast Transfer From John Citizen dinner split", 20000n],
    ]);
  }).pipe(Effect.provide(services)),
);
