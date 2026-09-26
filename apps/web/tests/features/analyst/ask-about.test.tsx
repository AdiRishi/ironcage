import {
  Ask,
  type AskContext,
  type Conversation,
  ConversationId,
  TurnId,
} from "@repo/contracts/analyst";
import {
  CalendarDate,
  CategoryId,
  Instant,
  PersonalEventId,
  type SpendingBreakdown,
  type SpendingRow,
  YearMonth,
} from "@repo/contracts/finance";
import { shiftYearMonth } from "@repo/finance";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { ask, getConversation, listConversations } from "@/features/analyst/functions";
import { getReferenceData } from "@/features/events/functions";
import { getFactsStatus, getMonthlyFlow } from "@/features/flow/functions";
import { getModelSettings } from "@/features/models/functions";
import { summarizeQuestions } from "@/features/questions/functions";
import { getSettings } from "@/features/settings/functions";
import { getSpending } from "@/features/spending/functions";
import { getRouter } from "@/router";
import { Route as root } from "@/routes/__root";
import type { callAnalystRpc } from "@/server/analyst-client.server";
import type { callApiRpc, fetchApi } from "@/server/api-client.server";

// These tests run the app's own routes, whose tree imports every feature's server
// functions, so `createServerFn` makes each one a mock. Server functions and the file
// routes that forward requests import the API and analyst clients, which no test calls.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: () => ({ handler: () => vi.fn<() => Promise<void>>() }),
    handler: () => vi.fn<() => Promise<void>>(),
  }),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- The API client is the remote transport boundary.
vi.mock("../../../src/server/api-client.server", () => ({
  callApiRpc: vi.fn<typeof callApiRpc>(),
  fetchApi: vi.fn<typeof fetchApi>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- The analyst client is the remote transport boundary.
vi.mock("../../../src/server/analyst-client.server", () => ({
  callAnalystRpc: vi.fn<typeof callAnalystRpc>(),
}));

const money = (minor: bigint) => ({ currency: "AUD", minor });
const food = CategoryId.make("00000000-0000-4000-8000-00000000000f");
const diningOut = CategoryId.make("00000000-0000-4000-8000-0000000000d0");
const groceries = CategoryId.make("00000000-0000-4000-8000-0000000000d1");
const japanTrip = PersonalEventId.make("00000000-0000-4000-8000-0000000000a7");
const conversationId = ConversationId.make("00000000-0000-4000-8000-0000000000c1");
const all = { kind: "all" } as const;
const foodScope = { category: { kind: "category", id: food }, counterparty: all } as const;
const july = { kind: "months", from: YearMonth.make("2026-07"), to: YearMonth.make("2026-07") };
const askedAt = Instant.make("2026-09-25T06:30:00.000Z");

// $100 of spending from one purchase in July and none in June.
const figures: SpendingBreakdown["figures"] = {
  current: money(10000n),
  previous: money(0n),
  change: money(10000n),
  percentChange: null,
  purchases: 1,
  previousPurchases: 0,
  averagePurchase: money(10000n),
  previousAveragePurchase: null,
  purchasesPart: null,
  averagePart: null,
  otherPart: money(0n),
  modelAmount: money(0n),
};
const row = (label: string, id: typeof CategoryId.Type, slug: string): SpendingRow => ({
  label,
  slug,
  opens: { category: { kind: "category", id }, counterparty: all },
  share: 50,
  figures,
  months: Array.from({ length: 12 }, (_, index) => money(index === 11 ? 10000n : 0n)),
});
// Food in July 2026: Dining out and Groceries.
const foodInJuly: SpendingBreakdown = {
  period: { start: CalendarDate.make("2026-07-01"), endExclusive: CalendarDate.make("2026-08-01") },
  comparison: {
    start: CalendarDate.make("2026-06-01"),
    endExclusive: CalendarDate.make("2026-07-01"),
  },
  basis: "spending",
  currency: "AUD",
  calculatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
  scope: foodScope,
  path: [{ label: "Food", opens: foodScope }],
  level: "categories",
  slug: "food",
  figures: { ...figures, current: money(20000n), change: money(20000n) },
  months: Array.from({ length: 12 }, (_, index) => ({
    month: shiftYearMonth(YearMonth.make("2025-08"), index),
    amount: money(index === 11 ? 20000n : 0n),
    modelAmount: money(0n),
    coverage: "complete" as const,
  })),
  coverage: [],
  comparisonCoverage: { state: "complete", gaps: [] },
  rows: [
    row("Dining out", diningOut, "food.dining"),
    row("Groceries", groceries, "food.groceries"),
  ],
};

const category = (
  id: typeof CategoryId.Type,
  parentId: typeof CategoryId.Type | null,
  name: string,
) => ({
  id,
  parentId,
  name,
  slug: null,
  tree: "spending" as const,
  position: 1,
  archived: false,
  version: 1,
});
const provider = {
  name: "Cloudflare Workers AI",
  model: "@cf/zai-org/glm-5.3-flash",
  inputMicrousdPerMillion: 150_000n,
  cachedInputMicrousdPerMillion: 30_000n,
  outputMicrousdPerMillion: 500_000n,
};

// The API and the analyst as far as these tests go: records for July and August 2026, Food
// in July, the analyst on, and no conversation until a question is asked. `asked` is the
// question the analyst received.
let asked: Ask | undefined;
function serve() {
  asked = undefined;
  vi.mocked(getSettings).mockResolvedValue({
    timezone: "Australia/Sydney",
    reportingCurrency: "AUD",
    version: 1,
  });
  vi.mocked(getMonthlyFlow).mockResolvedValue(
    ["2026-07", "2026-08"].map((month) => ({
      month: YearMonth.make(month),
      inflow: money(500000n),
      outflow: money(300000n),
      spending: money(300000n),
      modelShare: money(0n),
      coverage: "complete",
    })),
  );
  vi.mocked(getFactsStatus).mockResolvedValue({ outdated: 0, rebuilding: false });
  vi.mocked(summarizeQuestions).mockResolvedValue({
    period: null,
    count: 0,
    byFilter: { who: 0, people: 0, accounts: 0, rules: 0 },
    outflow: money(0n),
    inflow: money(0n),
  });
  vi.mocked(getSpending).mockResolvedValue(foodInJuly);
  vi.mocked(getReferenceData).mockResolvedValue({
    categories: [
      category(food, null, "Food"),
      category(diningOut, food, "Dining out"),
      category(groceries, food, "Groceries"),
    ],
    counterparties: [],
    tags: [],
    personalEvents: [
      {
        id: japanTrip,
        name: "Japan trip",
        startOn: CalendarDate.make("2026-07-10"),
        endOn: CalendarDate.make("2026-07-24"),
        excludeFromOrdinary: false,
        version: 1,
      },
    ],
  });
  vi.mocked(getModelSettings).mockResolvedValue({
    enrichment: { enabled: false, autoApplyConfidence: 0.8, provider },
    analyst: { enabled: true, provider },
    warning: null,
    version: 1,
  });
  vi.mocked(listConversations).mockResolvedValue({ rows: [], nextCursor: null });
  let conversation: Conversation | undefined;
  vi.mocked(ask).mockImplementation(async ({ data }) => {
    asked = await Effect.runPromise(Schema.decodeEffect(Ask)(data));
    conversation = {
      id: conversationId,
      title: asked.question,
      turns: [
        {
          id: TurnId.make(asked.commandId),
          question: asked.question,
          context: asked.context,
          status: "queued",
          steps: [],
          answer: null,
          message: null,
          askedAt,
          finishedAt: null,
        },
      ],
    };
    return conversation;
  });
  vi.mocked(getConversation).mockImplementation(async () => {
    if (!conversation) throw new Error("No question was asked.");
    return conversation;
  });
}

// The app's router, with its routes and pages, opened at an address. The root's shell
// renders <html> and <body>, which would land inside the test's container, and Chromium
// hangs focusing a text field under a nested <body>, so the pages render without it.
async function open(address: string, onTestFinished: (cleanup: () => Promise<void>) => void) {
  serve();
  const router = getRouter();
  Object.assign(root.options, { shellComponent: undefined });
  router.update({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const screen = await render(<RouterProvider router={router} />);
  onTestFinished(() => screen.unmount());
  return router;
}

test("Ask about this on a spending row opens a new question about that category in the period", async ({
  onTestFinished,
}) => {
  const router = await open(`/spending?period=2026-07&category=${food}`, onTestFinished);

  await page.getByRole("link", { name: "Ask about this: Dining out" }).click();

  await expect
    .element(page.getByRole("link", { name: "Dining out in July 2026" }))
    .toHaveAttribute("href", `/spending?period=2026-07&category=${diningOut}`);
  await expect
    .element(page.getByRole("button", { name: "Ask without Dining out in July 2026" }))
    .toBeVisible();
  expect(router.state.location.pathname).toBe("/analyst");
  expect(router.state.location.search).toEqual({
    period: "2026-07",
    about: {
      kind: "category",
      period: july,
      comparison: { kind: "previous" },
      category: { kind: "category", id: diningOut },
      counterparty: all,
    },
  });
});

test("removing what a question is about by keyboard asks without it and leaves you in the question box", async ({
  onTestFinished,
}) => {
  const router = await open(`/spending?period=2026-07&category=${food}`, onTestFinished);
  await page.getByRole("link", { name: "Ask about this: Dining out" }).click();

  const remove = page.getByRole("button", { name: "Ask without Dining out in July 2026" });
  await expect.element(remove).toBeVisible();
  remove.element().focus();
  await userEvent.keyboard("{Enter}");

  await expect.element(remove).not.toBeInTheDocument();
  await expect.element(page.getByRole("textbox", { name: "Your question" })).toHaveFocus();
  expect(router.state.location.search).toEqual({ period: "2026-07" });
  await userEvent.keyboard("What changed?{Enter}");

  await expect
    .element(page.getByRole("heading", { level: 2, name: "What changed?" }))
    .toBeVisible();
  expect(asked).toMatchObject({ question: "What changed?", context: null });
});

test("a question asked from Spending narrowed to a trip is asked about that trip's spending", async ({
  onTestFinished,
}) => {
  await open(
    `/spending?period=2026-07&category=${food}&personalEvent=${japanTrip}`,
    onTestFinished,
  );

  await page.getByRole("link", { name: "Ask about this", exact: true }).click();
  await expect
    .element(page.getByRole("link", { name: "Food for Japan trip in July 2026" }))
    .toBeVisible();
  await page.getByRole("textbox", { name: "Your question" }).click();
  await userEvent.keyboard("How much did the Japan trip cost?{Enter}");

  const question = page.getByRole("article", { name: "How much did the Japan trip cost?" });
  await expect
    .element(question.getByRole("link", { name: "Food for Japan trip in July 2026" }))
    .toHaveAttribute(
      "href",
      `/spending?period=2026-07&category=${food}&personalEvent=${japanTrip}`,
    );
  expect(asked?.context).toEqual({
    kind: "category",
    period: july,
    comparison: { kind: "previous" },
    ...foodScope,
    personalEventId: japanTrip,
  });
});

test("a question about income not yet categorised names its measure and opens the records behind it", async ({
  onTestFinished,
}) => {
  const uncategorisedIncome: AskContext = {
    kind: "stream",
    period: { kind: "months", from: YearMonth.make("2026-08"), to: YearMonth.make("2026-08") },
    comparison: { kind: "previous" },
    scope: { measure: "income", category: { kind: "uncategorised" }, counterparty: all },
  };
  const router = await open("/analyst?period=2026-08", onTestFinished);
  await router.navigate({ to: "/analyst", search: { about: uncategorisedIncome } });

  await expect
    .element(page.getByRole("link", { name: "Income not yet categorised in August 2026" }))
    .toHaveAttribute("href", "/ledger?period=2026-08&measure=income&category=uncategorised");
});
