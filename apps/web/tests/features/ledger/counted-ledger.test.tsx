import {
  type Account,
  AccountId,
  CalendarDate,
  type CountedLedgerPage as CountedResult,
  type CountedLedgerRow,
  Instant,
  PostingId,
  YearMonth,
} from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { getEventForPosting, getReferenceData } from "@/features/events/functions";
import { CountedList } from "@/features/ledger/list";
import { CountedLedgerPage } from "@/features/ledger/page";
import { resolvePeriodKey } from "@/lib/period";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  getEventForPosting: vi.fn<typeof getEventForPosting>(),
  getReferenceData: vi.fn<typeof getReferenceData>(),
}));

const money = (minor: bigint) => ({ currency: "AUD", minor });
const everyday: Account = {
  id: AccountId.make("00000000-0000-4000-8000-000000000001"),
  label: "Everyday",
  kind: "deposit",
  institution: "commbank",
  currency: "AUD",
  bankId: null,
  accountNumber: null,
  version: 1,
};
const row = (
  fields: Pick<typeof CountedLedgerRow.Type, "description" | "postedOn" | "on"> & {
    id: number;
    amount: bigint;
    counted: bigint;
    part?: number;
  },
): typeof CountedLedgerRow.Type => ({
  id: PostingId.make(`00000000-0000-4000-8000-${String(fields.id).padStart(12, "0")}`),
  accountId: everyday.id,
  accountLabel: "Everyday",
  postedOn: fields.postedOn,
  valueOn: null,
  amount: money(fields.amount),
  description: fields.description,
  originalMoney: null,
  eventId: null,
  role: "purchase",
  counterpartyId: null,
  counterpartyName: null,
  categoryId: null,
  categoryName: null,
  categorySlug: null,
  split: false,
  assignedBy: "you",
  question: false,
  part: fields.part ?? 0,
  on: fields.on,
  counted: money(fields.counted),
});
const day = (value: string) => CalendarDate.make(value);

async function renderList(props: Parameters<typeof CountedList>[0]) {
  const root = createRootRoute({ component: () => <CountedList {...props} /> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  return render(<RouterProvider router={router} />);
}

test("a row shows what it counts of what was booked, and when it posted if that differs", async ({
  onTestFinished,
}) => {
  const screen = await renderList({
    parts: [{ label: "Spending", sign: "add", amount: money(18000n), postings: 2 }],
    rows: [
      row({
        id: 1,
        description: "BIG SHOP SYDNEY AU",
        postedOn: day("2026-07-10"),
        on: day("2026-07-09"),
        amount: -12000n,
        counted: -8000n,
      }),
      row({
        id: 2,
        description: "WOOLWORTHS 1234 SYDNEY AU",
        postedOn: day("2026-07-03"),
        on: day("2026-07-03"),
        amount: -10000n,
        counted: -10000n,
      }),
    ],
  });
  onTestFinished(() => screen.unmount());

  const split = page.getByRole("link", { name: /BIG SHOP/ });
  await expect.element(split).toMatchTextContent(/−\$80\.00of −\$120\.00/);
  await expect.element(split).toMatchTextContent(/Posted 10 July 2026/);
  const whole = page.getByRole("link", { name: /WOOLWORTHS/ });
  await expect.element(whole).not.toMatchTextContent(/ of /);
  await expect.element(whole).not.toMatchTextContent(/Posted/);
});

test("a number made of two parts lists each part under its own heading", async ({
  onTestFinished,
}) => {
  const screen = await renderList({
    parts: [
      { label: "Repayments", sign: "add", amount: money(390000n), postings: 1 },
      {
        label: "Interest and fees on your loans",
        sign: "less",
        amount: money(280000n),
        postings: 1,
      },
    ],
    rows: [
      row({
        id: 1,
        description: "Loan Repayment LN REPAY 123456789",
        postedOn: day("2026-07-28"),
        on: day("2026-07-28"),
        amount: -390000n,
        counted: -390000n,
      }),
      row({
        id: 2,
        description: "Interest charged",
        postedOn: day("2026-07-27"),
        on: day("2026-07-27"),
        amount: -280000n,
        counted: -280000n,
        part: 1,
      }),
    ],
  });
  onTestFinished(() => screen.unmount());

  await expect
    .element(page.getByRole("region", { name: "Repayments" }).getByRole("link"))
    .toMatchTextContent(/Loan Repayment LN REPAY 123456789/);
  await expect
    .element(
      page.getByRole("region", { name: "Interest and fees on your loans" }).getByRole("link"),
    )
    .toMatchTextContent(/Interest charged/);
});

// July 2026's loan principal: a $3,900 repayment less $2,800 of interest on the loan.
const principal: typeof CountedResult.Type = {
  scope: { measure: "loanPrincipal", category: { kind: "all" }, counterparty: { kind: "all" } },
  label: "Loan principal",
  path: [],
  period: { start: day("2026-07-01"), endExclusive: day("2026-08-01") },
  basis: "spending",
  currency: "AUD",
  calculatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
  total: money(110000n),
  parts: [
    { label: "Repayments", sign: "add", amount: money(390000n), postings: 1 },
    { label: "Interest and fees on your loans", sign: "less", amount: money(280000n), postings: 1 },
  ],
  rows: [
    row({
      id: 1,
      description: "Loan Repayment LN REPAY 123456789",
      postedOn: day("2026-07-28"),
      on: day("2026-07-28"),
      amount: -390000n,
      counted: -390000n,
    }),
    row({
      id: 2,
      description: "Interest charged",
      postedOn: day("2026-07-27"),
      on: day("2026-07-27"),
      amount: -280000n,
      counted: -280000n,
      part: 1,
    }),
  ],
  nextCursor: null,
};

function Ledger() {
  const navigate = useNavigate();
  return (
    <CountedLedgerPage
      search={{ measure: "loanPrincipal" }}
      period={resolvePeriodKey(YearMonth.make("2026-07"), "Australia/Sydney")}
      page={principal}
      accounts={[everyday]}
      navigate={(search) => {
        navigate({ to: "/ledger", search }).catch(reportError);
      }}
    />
  );
}

async function renderLedger() {
  vi.mocked(getReferenceData).mockResolvedValue({
    categories: [],
    counterparties: [],
    tags: [],
    personalEvents: [],
  });
  const root = createRootRoute();
  const ledger = createRoute({ getParentRoute: () => root, path: "/ledger", component: Ledger });
  const router = createRouter({
    routeTree: root.addChildren([ledger]),
    history: createMemoryHistory({ initialEntries: ["/ledger?measure=loanPrincipal"] }),
  });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, screen, client };
}

test("the records behind a number are titled with it, total it, and subtotal its parts", async ({
  onTestFinished,
}) => {
  const { screen, client } = await renderLedger();
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
  });

  await expect
    .element(page.getByRole("heading", { level: 1 }))
    .toHaveTextContent("Loan principal in July 2026");
  await expect.element(page.getByText("$1,100.00", { exact: true })).toBeVisible();
  expect(
    page
      .getByRole("term")
      .elements()
      .map((term) => term.textContent),
  ).toEqual(["Repayments", "Interest and fees on your loans"]);
  expect(
    page
      .getByRole("definition")
      .elements()
      .map((amount) => amount.textContent),
  ).toEqual(["$3,900.00", "−$2,800.00"]);
});

test("filters narrow the records without leaving the number they came from", async ({
  onTestFinished,
}) => {
  const { router, screen, client } = await renderLedger();
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
  });

  await page.getByText("More filters").click();
  await expect.element(page.getByLabelText("Account")).toBeVisible();
  for (const scoped of ["Category", "Counterparty", "Currency", "Posted from", "Posted through"])
    await expect.element(page.getByLabelText(scoped, { exact: true })).not.toBeInTheDocument();

  await page.getByLabelText("Minimum amount").fill("-3000.00");
  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect
    .poll(() => router.state.location.search)
    .toEqual({ measure: "loanPrincipal", minimum: "-300000" });
});
