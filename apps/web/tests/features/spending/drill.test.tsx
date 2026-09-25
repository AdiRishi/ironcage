import {
  AccountId,
  CalendarDate,
  CategoryId,
  CounterpartyId,
  type CountedLedgerPage,
  type CountedLedgerRow,
  Instant,
  PersonalEventId,
  PostingId,
  Scope,
  type ScopeCrumb,
  type SpendingBreakdown,
  type SpendingRow,
  YearMonth,
} from "@repo/contracts/finance";
import { shiftYearMonth } from "@repo/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Schema } from "effect";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { getEventForPosting, getEventHistory, getReferenceData } from "@/features/events/functions";
import { getPosting, listCountedLedger, listLedger } from "@/features/ledger/functions";
import { getSpending } from "@/features/spending/functions";
import { SpendingPage } from "@/features/spending/page";
import { spendingQuery } from "@/features/spending/queries";
import {
  narrowingOf,
  SpendingSearch,
  spendingInput,
  transactionsInput,
} from "@/features/spending/search";
import { resolvePeriodKey } from "@/lib/period";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/spending/functions", () => ({
  getSpending: vi.fn<typeof getSpending>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/ledger/functions", () => ({
  getPosting: vi.fn<typeof getPosting>(),
  listCountedLedger: vi.fn<typeof listCountedLedger>(),
  listLedger: vi.fn<typeof listLedger>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  getEventForPosting: vi.fn<typeof getEventForPosting>(),
  getEventHistory: vi.fn<typeof getEventHistory>(),
  getReferenceData: vi.fn<typeof getReferenceData>(),
}));

const money = (minor: bigint) => ({ currency: "AUD", minor });
const food = CategoryId.make("00000000-0000-4000-8000-00000000000f");
const diningOut = CategoryId.make("00000000-0000-4000-8000-0000000000d0");
const dinnerPlace = CounterpartyId.make("00000000-0000-4000-8000-0000000000d1");
const cafe = CounterpartyId.make("00000000-0000-4000-8000-0000000000c1");
const birthday = PersonalEventId.make("00000000-0000-4000-8000-0000000000b1");
const july = {
  start: CalendarDate.make("2026-07-01"),
  endExclusive: CalendarDate.make("2026-08-01"),
};
const all = { kind: "all" } as const;
const diningScope = { category: { kind: "category", id: diningOut }, counterparty: all } as const;
const dinnerScope = {
  category: { kind: "category", id: diningOut },
  counterparty: { kind: "counterparty", id: dinnerPlace },
} as const;
const path: ScopeCrumb[] = [
  { label: "Food", opens: { category: { kind: "category", id: food }, counterparty: all } },
  { label: "Dining out", opens: diningScope },
];

// Spending of `current` against `previous` in June, from one purchase in July and none in
// June.
const figuresOf = (
  current: bigint,
  previous: bigint,
  percentChange: number | null,
): SpendingBreakdown["figures"] => ({
  current: money(current),
  previous: money(previous),
  change: money(current - previous),
  percentChange,
  purchases: 1,
  previousPurchases: 0,
  averagePurchase: money(current),
  previousAveragePurchase: null,
  purchasesPart: null,
  averagePart: null,
  otherPart: money(0n),
  modelAmount: money(0n),
});
// July's dinner: $300 at Dinner Place on 4 July, $200 of it repaid by John on 6 July.
const figures = figuresOf(10000n, 0n, null);
const lastMonth = (minor: bigint) =>
  Array.from({ length: 12 }, (_, index) => money(index === 11 ? minor : 0n));
const row = (
  label: string,
  counterparty: typeof CounterpartyId.Type,
  rowFigures: SpendingRow["figures"],
): SpendingRow => ({
  label,
  slug: "food.dining",
  opens: {
    category: diningScope.category,
    counterparty: { kind: "counterparty", id: counterparty },
  },
  share: 100,
  figures: rowFigures,
  months: lastMonth(rowFigures.current.minor),
});
const breakdown = (
  scope: Scope,
  fields: Pick<SpendingBreakdown, "path" | "level" | "rows"> &
    Partial<Pick<SpendingBreakdown, "figures" | "comparisonCoverage">>,
): SpendingBreakdown => ({
  period: july,
  comparison: { start: CalendarDate.make("2026-06-01"), endExclusive: july.start },
  basis: "spending",
  currency: "AUD",
  calculatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
  scope,
  slug: "food.dining",
  figures,
  months: lastMonth(10000n).map((amount, index) => ({
    month: shiftYearMonth(YearMonth.make("2025-08"), index),
    amount,
    coverage: "complete" as const,
  })),
  coverage: [],
  comparisonCoverage: { state: "complete", gaps: [] },
  ...fields,
});
const record = (
  id: number,
  description: string,
  postedOn: string,
  counted: bigint,
): typeof CountedLedgerRow.Type => ({
  id: PostingId.make(`00000000-0000-4000-8000-${String(id).padStart(12, "0")}`),
  accountId: AccountId.make("00000000-0000-4000-8000-0000000000a0"),
  accountLabel: "Everyday",
  postedOn: CalendarDate.make(postedOn),
  valueOn: null,
  amount: money(counted),
  description,
  originalMoney: null,
  eventId: null,
  role: counted < 0n ? "purchase" : "reimbursement",
  counterpartyId: null,
  counterpartyName: null,
  categoryId: diningOut,
  categoryName: "Dining out",
  categorySlug: "food.dining",
  split: false,
  assignedBy: "you",
  question: false,
  part: 0,
  on: CalendarDate.make("2026-07-04"),
  counted: money(counted),
});
const dinnerRecords: typeof CountedLedgerPage.Type = {
  scope: { measure: "spending", ...dinnerScope },
  label: "Dinner Place",
  path: [...path, { label: "Dinner Place", opens: dinnerScope }],
  period: july,
  basis: "spending",
  currency: "AUD",
  calculatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
  total: money(10000n),
  parts: [{ label: "Spending", sign: "add", amount: money(10000n), postings: 2 }],
  rows: [
    record(1, "DINNER PLACE SYDNEY", "2026-07-04", -30000n),
    record(2, "Transfer from John", "2026-07-06", 20000n),
  ],
  nextCursor: null,
};

const same = ({ category, counterparty }: typeof Scope.Encoded, scope: typeof Scope.Encoded) =>
  category.kind === scope.category.kind &&
  ("id" in category ? category.id : null) === ("id" in scope.category ? scope.category.id : null) &&
  counterparty.kind === scope.counterparty.kind &&
  ("id" in counterparty ? counterparty.id : null) ===
    ("id" in scope.counterparty ? scope.counterparty.id : null);

// The API as far as this drill goes: Dining out opens its counterparties, and Dinner
// Place opens its records, both narrowed to `personalEventId` when given. Any other
// request is one the drill should not make.
function serve(personalEventId?: typeof PersonalEventId.Type) {
  vi.mocked(getReferenceData).mockResolvedValue({
    categories: [],
    counterparties: [],
    tags: [],
    personalEvents: [
      {
        id: birthday,
        name: "Birthday dinner",
        startOn: CalendarDate.make("2026-07-04"),
        endOn: CalendarDate.make("2026-07-04"),
        excludeFromOrdinary: false,
        version: 1,
      },
    ],
  });
  vi.mocked(getSpending).mockImplementation(async ({ data }) => {
    if (data.personalEventId === personalEventId && same(data, diningScope))
      return breakdown(diningScope, {
        path,
        level: "counterparties",
        rows: [row("Dinner Place", dinnerPlace, figures)],
      });
    if (data.personalEventId === personalEventId && same(data, dinnerScope))
      return breakdown(dinnerScope, { path: dinnerRecords.path, level: "transactions", rows: [] });
    throw new Error(`No spending for ${JSON.stringify(data)}`);
  });
  vi.mocked(listCountedLedger).mockImplementation(async ({ data }) => {
    if (
      data.filter.personalEventId === personalEventId &&
      data.scope.measure === "spending" &&
      same(data.scope, dinnerScope)
    )
      return dinnerRecords;
    throw new Error(`No records for ${JSON.stringify(data)}`);
  });
}

const period = resolvePeriodKey(YearMonth.make("2026-07"), "Australia/Sydney");
const root = createRootRoute();
const spending = createRoute({
  getParentRoute: () => root,
  path: "/spending",
  validateSearch: Schema.toStandardSchemaV1(SpendingSearch),
  component: function Spending() {
    const search = spending.useSearch();
    const { data } = useSuspenseQuery(
      spendingQuery(spendingInput(search, period, undefined, "AUD")),
    );
    return (
      <SpendingPage
        breakdown={data}
        transactions={transactionsInput(search, period, "AUD")}
        period={period}
        compare={undefined}
        onCompare={() => {}}
        firstMonth={YearMonth.make("2025-08")}
        today={CalendarDate.make("2026-09-25")}
        narrowing={narrowingOf(search)}
      />
    );
  },
});

async function renderSpending(
  address: string,
  onTestFinished: (cleanup: () => Promise<void>) => void,
) {
  const router = createRouter({
    routeTree: root.addChildren([spending]),
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(getSpending).mockReset();
    vi.mocked(listCountedLedger).mockReset();
    vi.mocked(getReferenceData).mockReset();
  });
  return router;
}

const crumbs = () =>
  page.getByRole("navigation", { name: "Spending path" }).getByRole("link").elements();
// The Change cell of a breakdown row, after its name and amount.
const changeOf = (name: string) =>
  page
    .getByRole("row", { name: new RegExp(`^${name}`) })
    .getByRole("cell")
    .nth(1);

test("a counterparty row opens the records it counts, under the same header", async ({
  onTestFinished,
}) => {
  serve();
  const router = await renderSpending(`/spending?category=${diningOut}`, onTestFinished);

  await expect
    .element(page.getByRole("columnheader", { name: "Counterparty" }))
    .toBeInTheDocument();
  await page.getByRole("link", { name: "Dinner Place" }).click();

  await expect
    .element(page.getByRole("heading", { level: 1 }))
    .toHaveTextContent("Dining out at Dinner Place in July 2026");
  expect(router.state.location.search).toEqual({ category: diningOut, counterparty: dinnerPlace });
  await expect
    .element(page.getByRole("link", { name: /DINNER PLACE SYDNEY/ }))
    .toMatchTextContent(/−\$300\.00/);
  const repayment = page.getByRole("link", { name: /Transfer from John/ });
  await expect.element(repayment).toMatchTextContent(/\+\$200\.00/);
  await expect.element(repayment).toMatchTextContent(/Posted 6 July 2026/);
  expect(crumbs().map((link) => link.textContent)).toEqual([
    "All spending",
    "Food",
    "Dining out",
    "Dinner Place",
  ]);
  await expect
    .element(page.getByRole("link", { name: "Open the page for Dinner Place" }))
    .toHaveAttribute("href", `/counterparties/${dinnerPlace}`);
});

test("a personal event narrows every level of the drill and the records it opens", async ({
  onTestFinished,
}) => {
  serve(birthday);
  const router = await renderSpending(
    `/spending?category=${diningOut}&personalEvent=${birthday}`,
    onTestFinished,
  );

  await expect.element(page.getByText(/^Only spending for Birthday dinner\./)).toBeVisible();
  await page.getByRole("link", { name: "Dinner Place" }).click();

  await expect
    .element(page.getByRole("heading", { level: 1 }))
    .toHaveTextContent("Dining out at Dinner Place in July 2026");
  expect(router.state.location.search).toEqual({
    category: diningOut,
    counterparty: dinnerPlace,
    personalEvent: birthday,
  });
  await expect.element(page.getByRole("link", { name: /DINNER PLACE SYDNEY/ })).toBeVisible();
  const query = (href: string | null) => new URLSearchParams(href?.split("?")[1]);
  expect(crumbs().map((link) => query(link.getAttribute("href")).get("personalEvent"))).toEqual([
    birthday,
    birthday,
    birthday,
    birthday,
  ]);
  const ledger = query(
    page
      .getByRole("link", { name: "See these transactions in the ledger" })
      .element()
      .getAttribute("href"),
  );
  expect([ledger.get("measure"), ledger.get("personalEventId")]).toEqual(["spending", birthday]);
});

test("without records to compare with, no change reads as new", async ({ onTestFinished }) => {
  vi.mocked(getSpending).mockResolvedValue(
    breakdown(diningScope, {
      path,
      level: "counterparties",
      comparisonCoverage: { state: "missing", gaps: [] },
      rows: [row("Dinner Place", dinnerPlace, figures), row("Cafe", cafe, figures)],
    }),
  );
  await renderSpending(`/spending?category=${diningOut}`, onTestFinished);

  await expect
    .element(page.getByText("No records to compare with.", { exact: true }))
    .toBeVisible();
  await expect.element(changeOf("Dinner Place")).toHaveTextContent("No records");
  await expect.element(changeOf("Cafe")).toHaveTextContent("No records");
});

test("a change from nothing reads as new, and a change from net refunds has no percentage", async ({
  onTestFinished,
}) => {
  vi.mocked(getSpending).mockResolvedValue(
    breakdown(diningScope, {
      path,
      level: "counterparties",
      // $150 against −$50: Dinner Place's $100 after a $50 refund in June, and $50 at a
      // new cafe.
      figures: figuresOf(15000n, -5000n, null),
      rows: [
        row("Dinner Place", dinnerPlace, figuresOf(10000n, -5000n, null)),
        row("Cafe", cafe, figuresOf(5000n, 0n, null)),
      ],
    }),
  );
  await renderSpending(`/spending?category=${diningOut}`, onTestFinished);

  await expect
    .element(page.getByText("$200 more than in June 2026, which was −$50.", { exact: true }))
    .toBeVisible();
  await expect.element(changeOf("Dinner Place")).toMatchTextContent(/^\+\$150$/);
  await expect.element(changeOf("Cafe")).toMatchTextContent(/^New$/);
});
