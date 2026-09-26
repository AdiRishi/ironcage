import {
  Ask,
  type Conversation,
  ConversationId,
  type Figure,
  FigureId,
  type Turn,
  TurnId,
} from "@repo/contracts/analyst";
import { AccountId, CalendarDate, CategoryId, Instant, YearMonth } from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  retainSearchParams,
} from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { ConversationView } from "@/features/analyst/conversation";
import {
  ask,
  getBriefing,
  getConversation,
  listBriefings,
  listConversations,
  refreshProposal,
  requestBriefing,
  resolveProposal,
} from "@/features/analyst/functions";
import { AnalystPage } from "@/features/analyst/page";
import { conversationQuery } from "@/features/analyst/queries";
import { applyCounterpartyChange } from "@/features/counterparties/functions";
import {
  applyCorrection,
  getEventForPosting,
  getEventHistory,
  getReferenceData,
} from "@/features/events/functions";
import { getPosting, listCountedLedger, listLedger } from "@/features/ledger/functions";
import { getRetention, getSettings } from "@/features/settings/functions";
import { AppRequestError } from "@/lib/app-error";
import { PeriodSearch } from "@/lib/period";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/analyst/functions", () => ({
  ask: vi.fn<typeof ask>(),
  getBriefing: vi.fn<typeof getBriefing>(),
  getConversation: vi.fn<typeof getConversation>(),
  listBriefings: vi.fn<typeof listBriefings>(),
  listConversations: vi.fn<typeof listConversations>(),
  refreshProposal: vi.fn<typeof refreshProposal>(),
  requestBriefing: vi.fn<typeof requestBriefing>(),
  resolveProposal: vi.fn<typeof resolveProposal>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/counterparties/functions", () => ({
  applyCounterpartyChange: vi.fn<typeof applyCounterpartyChange>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  applyCorrection: vi.fn<typeof applyCorrection>(),
  getEventForPosting: vi.fn<typeof getEventForPosting>(),
  getEventHistory: vi.fn<typeof getEventHistory>(),
  getReferenceData: vi.fn<typeof getReferenceData>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/ledger/functions", () => ({
  getPosting: vi.fn<typeof getPosting>(),
  listCountedLedger: vi.fn<typeof listCountedLedger>(),
  listLedger: vi.fn<typeof listLedger>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/settings/functions", () => ({
  getRetention: vi.fn<typeof getRetention>(),
  getSettings: vi.fn<typeof getSettings>(),
}));

const conversationId = ConversationId.make("00000000-0000-4000-8000-0000000000c1");
const diningOut = CategoryId.make("00000000-0000-4000-8000-0000000000d0");
const august = {
  kind: "months",
  from: YearMonth.make("2026-08"),
  to: YearMonth.make("2026-08"),
} as const;
const askedAt = Instant.make("2026-09-25T06:30:00.000Z");
const calculatedAt = Instant.make("2026-09-25T06:32:00.000Z");
const period = (start: string, endExclusive: string) => ({
  start: CalendarDate.make(start),
  endExclusive: CalendarDate.make(endExclusive),
});

// Dining out's rise from July to August, which opens Spending at Dining out for August.
const rise: Figure = {
  id: FigureId.make("f2"),
  label: "Dining out, change from July 2026 to August 2026",
  value: { kind: "money", amount: { currency: "AUD", minor: 31000n }, signed: true },
  basis: "spending",
  calculatedAt,
  modelAmount: null,
  records: {
    kind: "spending",
    period: august,
    comparison: { kind: "previous" },
    category: { kind: "category", id: diningOut },
    counterparty: { kind: "all" },
  },
};
const reading = {
  label: "Reading spending in Food for August 2026",
  records: { kind: "overview", period: august, comparison: { kind: "previous" } },
} as const;
const asked = {
  id: TurnId.make("00000000-0000-4000-8000-0000000000e1"),
  question: "Why was August more expensive than July?",
  context: null,
  askedAt,
};
const answered: Turn = {
  ...asked,
  status: "answered",
  steps: [reading],
  finishedAt: calculatedAt,
  answer: {
    text: "Dining out rose [[f2]].",
    missing: [],
    figures: [rise],
    records: [],
    basis: {
      periods: [
        {
          period: period("2026-08-01", "2026-09-01"),
          comparison: period("2026-07-01", "2026-08-01"),
        },
      ],
      basis: "spending",
      currency: "AUD",
      accounts: [
        {
          account: {
            id: AccountId.make("00000000-0000-4000-8000-0000000000a0"),
            kind: "deposit",
            label: "Everyday",
            currency: "AUD",
          },
          missing: [],
          reconciled: [],
        },
      ],
      otherCurrencyAccounts: [],
      calculatedAt,
    },
    limits: [],
    proposals: [],
  },
};

// The analyst as far as these tests go: one conversation, where asking queues a question
// unless one is still waiting.
let stored: Conversation;
function serve(...turns: Turn[]) {
  stored = { id: conversationId, title: "Why was August more expensive than July?", turns };
  vi.mocked(getSettings).mockResolvedValue({
    timezone: "Australia/Sydney",
    reportingCurrency: "AUD",
    version: 1,
  });
  vi.mocked(getConversation).mockImplementation(async () => stored);
  vi.mocked(listConversations).mockResolvedValue({ rows: [], nextCursor: null });
  vi.mocked(ask).mockImplementation(async ({ data }) => {
    const input = await Effect.runPromise(Schema.decodeEffect(Ask)(data));
    if (stored.turns.some((turn) => turn.status === "queued" || turn.status === "running"))
      throw new AppRequestError("conflict", "The analyst is still answering the last question.");
    const queued: Turn = {
      id: TurnId.make(input.commandId),
      question: input.question,
      context: input.context,
      status: "queued",
      steps: [],
      askedAt,
    };
    stored = { ...stored, turns: [...stored.turns, queued] };
    return stored;
  });
}

// The conversation beside the list, under a root that keeps the period and comparison
// from one address to the next, as the app's does.
async function renderConversation(
  onTestFinished: (cleanup: () => Promise<void>) => void,
  address = `/analyst/${conversationId}`,
) {
  const root = createRootRoute({
    validateSearch: Schema.toStandardSchemaV1(PeriodSearch),
    search: { middlewares: [retainSearchParams(["period", "compare"])] },
  });
  const open = createRoute({
    getParentRoute: () => root,
    path: "/analyst/$conversationId",
    component: function Open() {
      const { data } = useSuspenseQuery(conversationQuery(conversationId));
      return (
        <AnalystPage open={conversationId}>
          <ConversationView conversation={data} enabled />
        </AnalystPage>
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([open]),
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
    vi.mocked(ask).mockReset();
    vi.mocked(getConversation).mockReset();
    vi.mocked(listConversations).mockReset();
    vi.mocked(getSettings).mockReset();
  });
}

test("a figure in an answer links to the spending it was read from, for that period and comparison", async ({
  onTestFinished,
}) => {
  serve(answered);
  // The address holds another month and last year's comparison, which the figure replaces.
  await renderConversation(
    onTestFinished,
    `/analyst/${conversationId}?period=2026-07&compare=lastYear`,
  );

  await expect
    .element(page.getByRole("paragraph").filter({ hasText: "Dining out rose" }))
    .toMatchTextContent(/^Dining out rose \+\$310\.00/);
  await expect
    .element(page.getByRole("link", { name: /^\+\$310\.00/ }))
    .toHaveAttribute("href", `/spending?period=2026-08&category=${diningOut}`);
  await expect
    .element(page.getByText(/^Based on August 2026 compared with July 2026/))
    .toMatchTextContent(/by spending date, in AUD, from Everyday\./);
});

test("a running question shows each step, then the answer once the analyst finishes", async ({
  onTestFinished,
}) => {
  serve({ ...asked, status: "running", steps: [reading] });
  await renderConversation(onTestFinished);

  await expect.element(page.getByText("Reading spending in Food for August 2026…")).toBeVisible();
  stored = { ...stored, turns: [answered] };

  const answer = page.getByRole("region", { name: "Answer" });
  await expect.element(answer, { timeout: 3000 }).toMatchTextContent(/Dining out rose \+\$310/);
  await expect.element(answer).toHaveFocus();
  await expect.element(page.getByText("Answer ready")).toBeInTheDocument();
});

test("Enter sends the question and Shift+Enter starts a new line", async ({ onTestFinished }) => {
  serve(answered);
  await renderConversation(onTestFinished);

  const box = page.getByRole("textbox", { name: "Ask a follow-up question" });
  await box.click();
  await userEvent.keyboard("Where did it go?{Shift>}{Enter}{/Shift}And why?");
  await expect.element(box).toHaveValue("Where did it go?\nAnd why?");
  await userEvent.keyboard("{Enter}");

  const asked = page.getByRole("heading", { level: 2, name: "Where did it go? And why?" });
  await expect.element(asked).toBeVisible();
  expect(asked.element().textContent).toBe("Where did it go?\nAnd why?");
  await expect.element(box).toHaveValue("");
});

test("a question asked while the analyst is off says to turn it on in Settings", async ({
  onTestFinished,
}) => {
  serve({
    ...asked,
    status: "blocked",
    steps: [],
    message: "The analyst is off. Turn it on in Settings.",
    finishedAt: calculatedAt,
  });
  await renderConversation(onTestFinished);

  await expect.element(page.getByText("The analyst is off. Turn it on in Settings.")).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Open Settings" }))
    .toHaveAttribute("href", "/settings");
  await expect.element(page.getByRole("button", { name: "Ask again" })).not.toBeInTheDocument();
});

test("a question whose reply was lost leaves focus on Retry, which sends it again", async ({
  onTestFinished,
}) => {
  serve(answered);
  vi.mocked(ask).mockRejectedValueOnce(
    new AppRequestError("unavailable", "The analyst could not be reached. Try again."),
  );
  await renderConversation(onTestFinished);

  const box = page.getByRole("textbox", { name: "Ask a follow-up question" });
  await box.click();
  await userEvent.keyboard("Where did it go?{Enter}");

  await expect
    .element(page.getByText("The analyst could not be reached. Try again."))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Retry" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");

  await expect
    .element(page.getByRole("heading", { level: 2, name: "Where did it go?" }))
    .toBeVisible();
});

test("the open conversation is marked by an Intaglio rule and weight, not only a tint", async ({
  onTestFinished,
}) => {
  await page.viewport(1280, 900);
  serve(answered);
  vi.mocked(listConversations).mockResolvedValue({
    rows: [
      {
        id: ConversationId.make("00000000-0000-4000-8000-0000000000c2"),
        title: "What did I spend on groceries?",
        updatedAt: askedAt,
        answering: false,
      },
      {
        id: conversationId,
        title: "Why was August more expensive than July?",
        updatedAt: askedAt,
        answering: false,
      },
    ],
    nextCursor: null,
  });
  await renderConversation(onTestFinished);

  const list = page.getByRole("navigation", { name: "Conversations" });
  const open = list.getByRole("link", { name: /^Why was August more expensive/ });
  const other = list.getByRole("link", { name: /^What did I spend on groceries/ });
  await expect.element(open).toHaveAttribute("aria-current", "page");
  await expect.element(other).not.toHaveAttribute("aria-current");
  await expect
    .element(list.getByRole("button", { name: "New question" }))
    .not.toHaveAttribute("aria-current");
  const styleOf = (link: typeof open) => getComputedStyle(link.element());
  expect(styleOf(open).borderLeftColor).toBe("rgb(22, 50, 58)");
  expect(styleOf(open).fontWeight).toBe("560");
  expect(styleOf(other).borderLeftColor).toBe("rgba(0, 0, 0, 0)");
  expect(styleOf(other).fontWeight).not.toBe("560");
});

test("focus on a link under the question box scrolls it clear of the box", async ({
  onTestFinished,
}) => {
  await page.viewport(390, 844);
  await document.fonts.load('1rem "Archivo Variable"');
  serve(
    ...Array.from({ length: 8 }, (_, index) => ({
      ...answered,
      id: TurnId.make(`00000000-0000-4000-8000-0000000000e${index + 1}`),
    })),
  );
  await renderConversation(onTestFinished);

  const box = page.getByRole("textbox", { name: "Ask a follow-up question" });
  await expect.element(box).toBeVisible();
  const composer = box.element().closest("form")?.parentElement;
  const figure = page
    .getByRole("link", { name: /^\+\$310\.00/ })
    .last()
    .element();
  if (!composer) throw new Error("The question box sits in no form.");
  // Scroll the last figure just under the top of the question box, still inside the screen.
  const covered = composer.getBoundingClientRect().top + 4;
  window.scrollBy(0, figure.getBoundingClientRect().top - covered);
  expect(figure.getBoundingClientRect().top).toBeGreaterThan(composer.getBoundingClientRect().top);

  figure.focus();

  expect(figure.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    composer.getBoundingClientRect().top,
  );
});
