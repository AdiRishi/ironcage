import {
  AccountId,
  AllocationId,
  ApplyCorrection,
  CalendarDate,
  CategoryId,
  type Counterparty,
  CounterpartyChange,
  CounterpartyChangeId,
  CounterpartyId,
  EventChange,
  EventId,
  type FinancialEvent,
  Instant,
  PostingId,
  type Question,
  QuestionId,
  type ReferenceData,
  RuleId,
  questionFilterKinds,
} from "@repo/contracts/finance";
import { QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { Effect, Schema } from "effect";
import { Suspense } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import {
  applyCounterpartyChange,
  getCounterparty,
  listCounterparties,
  listCounterpartyHistory,
  previewCounterpartyChange,
  previewCounterpartyUndo,
  searchDescriptors,
  undoCounterpartyChange,
} from "@/features/counterparties/functions";
import {
  applyCorrection,
  assignEventCounterparty,
  getEvent,
  getEventForPosting,
  getEventHistory,
  getReferenceData,
  previewCorrection,
  previewEventCounterparty,
  previewUndoCorrection,
  reinterpretPostings,
  undoCorrection,
} from "@/features/events/functions";
import { listQuestions, summarizeQuestions } from "@/features/questions/functions";
import { QuestionsPage } from "@/features/questions/page";
import { questionSummaryQuery } from "@/features/questions/queries";
import { AppRequestError } from "@/lib/app-error";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/questions/functions", () => ({
  listQuestions: vi.fn<typeof listQuestions>(),
  summarizeQuestions: vi.fn<typeof summarizeQuestions>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/counterparties/functions", () => ({
  listCounterparties: vi.fn<typeof listCounterparties>(),
  getCounterparty: vi.fn<typeof getCounterparty>(),
  searchDescriptors: vi.fn<typeof searchDescriptors>(),
  previewCounterpartyChange: vi.fn<typeof previewCounterpartyChange>(),
  applyCounterpartyChange: vi.fn<typeof applyCounterpartyChange>(),
  listCounterpartyHistory: vi.fn<typeof listCounterpartyHistory>(),
  previewCounterpartyUndo: vi.fn<typeof previewCounterpartyUndo>(),
  undoCounterpartyChange: vi.fn<typeof undoCounterpartyChange>(),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/events/functions", () => ({
  reinterpretPostings: vi.fn<typeof reinterpretPostings>(),
  getEvent: vi.fn<typeof getEvent>(),
  getEventForPosting: vi.fn<typeof getEventForPosting>(),
  getReferenceData: vi.fn<typeof getReferenceData>(),
  previewCorrection: vi.fn<typeof previewCorrection>(),
  applyCorrection: vi.fn<typeof applyCorrection>(),
  previewEventCounterparty: vi.fn<typeof previewEventCounterparty>(),
  assignEventCounterparty: vi.fn<typeof assignEventCounterparty>(),
  previewUndoCorrection: vi.fn<typeof previewUndoCorrection>(),
  undoCorrection: vi.fn<typeof undoCorrection>(),
  getEventHistory: vi.fn<typeof getEventHistory>(),
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const aud = (minor: bigint) => ({ currency: "AUD", minor });
const rent = CategoryId.make(uuid(90));
const groceries = CategoryId.make(uuid(91));
const counterparty = (
  n: number,
  name: string,
  fields: Partial<Counterparty> = {},
): Counterparty => ({
  id: CounterpartyId.make(uuid(n)),
  name,
  kind: "business",
  brand: null,
  defaultCategoryId: null,
  defaultRole: null,
  source: "user",
  status: "applied",
  model: null,
  confidence: null,
  reason: null,
  version: 1,
  updatedAt: Instant.make("2026-09-25T00:00:00.000Z"),
  ...fields,
});
const woolworths = counterparty(1, "Woolworths", { version: 4 });
const coles = counterparty(2, "Coles", { version: 7 });
const jane = counterparty(3, "Jane Smith", { kind: "person" });
const references: typeof ReferenceData.Type = {
  categories: [
    {
      id: rent,
      parentId: null,
      name: "Rent",
      slug: null,
      tree: "spending",
      position: 0,
      archived: false,
      version: 1,
    },
    {
      id: groceries,
      parentId: null,
      name: "Groceries",
      slug: null,
      tree: "spending",
      position: 1,
      archived: false,
      version: 1,
    },
  ],
  counterparties: [woolworths, coles, jane].map(({ id, name, kind, version }) => ({
    id,
    name,
    kind,
    version,
  })),
  tags: [],
  personalEvents: [],
};

const sample = (n: number, postedOn: string, description: string, minor: bigint) => ({
  eventId: EventId.make(uuid(n)),
  postingId: PostingId.make(uuid(n)),
  postedOn: CalendarDate.make(postedOn),
  description,
  amount: aud(-minor),
});
// A question about two payments of `minor` cents each, in July and August 2026.
const base = (id: string, n: number, description: string, minor: bigint) => ({
  id: QuestionId.make(id),
  affects: {
    eventCount: 2,
    outflow: aud(minor * 2n),
    inflow: aud(0n),
    firstOn: CalendarDate.make("2026-07-01"),
    lastOn: CalendarDate.make("2026-08-01"),
  },
  affectsInPeriod: null,
  samples: [
    sample(n + 1, "2026-07-01", description, minor),
    sample(n + 2, "2026-08-01", description, minor),
  ] as const,
});
const model = { kind: "model", confidence: 0.7, reason: "Same shop name." } as const;
// The model thinks the Metro descriptor is Coles.
const metro: Question = {
  kind: "alias",
  ...base("alias:WOOLWORTHS METRO", 100, "WOOLWORTHS METRO SURRY HILLS", 4_000n),
  aliasKey: "WOOLWORTHS METRO",
  aliasVersion: 2,
  counterparty: coles,
  basis: model,
};
const janeRent: Question = {
  kind: "person",
  ...base(`person:${jane.id}:rent`, 200, "Transfer to Jane Smith Rent Aug", 184_000n),
  counterparty: jane,
  reference: { key: "rent", sample: "Rent Aug" },
  proposal: { role: "purchase", categoryId: rent, basis: { kind: "reference" } },
};
const janeDinner: Question = {
  kind: "person",
  ...base(`person:${jane.id}:dinner split`, 300, "Transfer to Jane Smith dinner split", 4_000n),
  counterparty: jane,
  reference: { key: "dinner split", sample: "dinner split" },
  proposal: null,
};
const account: Question = {
  kind: "ownAccount",
  ...base("ownAccount:ACCOUNT 9921", 400, "Transfer to xx9921", 500_000n),
  aliasKey: "ACCOUNT 9921",
  aliasVersion: null,
};
// A counterparty the model proposed for the Woolies descriptor.
const woolies = counterparty(5, "Woolies", {
  source: "model",
  status: "proposed",
  confidence: 0.6,
  version: 3,
});
const proposed: Question = {
  kind: "counterparty",
  ...base(`counterparty:${woolies.id}`, 600, "WOOLIES 1234 SYDNEY", 6_000n),
  counterparty: woolies,
  basis: model,
};
// A $150 card purchase with no category, which two rules would file in different ones.
const market: FinancialEvent = {
  id: EventId.make(uuid(501)),
  kind: "purchase",
  roleSource: "bank",
  counterpartyId: null,
  counterpartySource: null,
  magnitude: aud(15_000n),
  primaryPostingId: PostingId.make(uuid(501)),
  reportingAccountId: AccountId.make(uuid(80)),
  purchaseOn: null,
  active: true,
  version: 2,
  allocations: [
    {
      id: AllocationId.make(uuid(502)),
      role: "purchase",
      amount: aud(15_000n),
      categoryId: null,
      categorySource: null,
      nonPersonal: false,
      tagIds: [],
      personalEventIds: [],
    },
  ],
  postings: [],
};
const conflict: Question = {
  kind: "ruleConflict",
  id: QuestionId.make(`ruleConflict:${market.id}`),
  affects: {
    eventCount: 1,
    outflow: aud(15_000n),
    inflow: aud(0n),
    firstOn: CalendarDate.make("2026-08-03"),
    lastOn: CalendarDate.make("2026-08-03"),
  },
  affectsInPeriod: null,
  samples: [sample(501, "2026-08-03", "SYNTHETIC MARKET", 15_000n)],
  eventId: market.id,
  postingId: market.primaryPostingId,
  rules: [
    {
      id: RuleId.make(uuid(701)),
      name: "Market rent",
      action: { kind: "category", categoryId: rent },
    },
    {
      id: RuleId.make(uuid(702)),
      name: "Market groceries",
      action: { kind: "category", categoryId: groceries },
    },
  ],
};

// The API as far as questions go: the open questions, `pageSize` at a time, and the
// answers applied to them. An answer removes the question it settles, and one that names
// no open question at the versions it carries fails as stale. A correction answers the
// question about its event.
function fakeApi(open: Question[], pageSize = open.length) {
  const answers: CounterpartyChange[] = [];
  const corrections: EventChange[] = [];
  let gate: Promise<void> | null = null;
  const decode = (encoded: typeof CounterpartyChange.Encoded) =>
    Effect.runPromise(Schema.decodeEffect(CounterpartyChange)(encoded));
  vi.mocked(listQuestions).mockImplementation(async ({ data: { cursor } }) => {
    await gate;
    const start = cursor ? open.findIndex((question) => question.id === cursor.id) + 1 : 0;
    const rows = open.slice(start, start + pageSize);
    const last = rows.at(-1);
    return {
      rows,
      nextCursor:
        last && start + pageSize < open.length
          ? { rankMinor: last.affects.outflow.minor, id: last.id }
          : null,
    };
  });
  vi.mocked(summarizeQuestions).mockImplementation(async () => {
    const count = (kinds: readonly Question["kind"][]) =>
      open.filter((question) => kinds.includes(question.kind)).length;
    return {
      period: null,
      count: open.length,
      byFilter: {
        who: count(questionFilterKinds.who),
        people: count(questionFilterKinds.people),
        accounts: count(questionFilterKinds.accounts),
        rules: count(questionFilterKinds.rules),
      },
      outflow: aud(open.reduce((sum, question) => sum + question.affects.outflow.minor, 0n)),
      inflow: aud(0n),
    };
  });
  // The question an answer settles: the one whose records it names at the versions the
  // question carries.
  const settles = (question: Question, change: CounterpartyChange) => {
    const descriptor =
      question.kind === "alias" || question.kind === "ownAccount"
        ? { aliasKey: question.aliasKey, expectedVersion: question.aliasVersion }
        : null;
    switch (change.kind) {
      case "moveAlias":
        return (
          change.aliasKey === descriptor?.aliasKey &&
          change.expectedVersion === descriptor.expectedVersion
        );
      case "create":
        return change.aliases.some(
          (alias) =>
            alias.aliasKey === descriptor?.aliasKey &&
            alias.expectedVersion === descriptor.expectedVersion,
        );
      case "saveReference":
        return (
          question.kind === "person" &&
          question.counterparty.id === change.counterpartyId &&
          question.reference?.key === change.referenceKey &&
          change.expectedVersion === null
        );
      case "merge":
        return (
          question.kind === "counterparty" &&
          question.counterparty.id === change.sourceId &&
          question.counterparty.version === change.sourceVersion &&
          references.counterparties.some(
            (target) => target.id === change.targetId && target.version === change.targetVersion,
          )
        );
      default:
        return false;
    }
  };
  const settled = (change: CounterpartyChange) => {
    const question = open.find((row) => settles(row, change));
    if (!question) throw new AppRequestError("stale", "This question changed. Answer it again.");
    return question;
  };
  vi.mocked(previewCounterpartyChange).mockImplementation(async ({ data }) => {
    const change = await decode(data.change);
    return { change, eventCount: settled(change).affects.eventCount, impacts: [], event: null };
  });
  vi.mocked(applyCounterpartyChange).mockImplementation(async ({ data }) => {
    const change = await decode(data.change);
    const question = settled(change);
    answers.push(change);
    open.splice(open.indexOf(question), 1);
    return {
      changeId: CounterpartyChangeId.make(uuid(999)),
      counterparty: woolworths,
    };
  });
  vi.mocked(getEventForPosting).mockResolvedValue(market);
  vi.mocked(previewCorrection).mockImplementation(async ({ data }) => ({
    change: await Effect.runPromise(Schema.decodeEffect(EventChange)(data.change)),
    expectedVersions: [{ eventId: market.id, version: market.version }],
    impacts: [],
  }));
  vi.mocked(applyCorrection).mockImplementation(async ({ data }) => {
    const { change } = await Effect.runPromise(Schema.decodeEffect(ApplyCorrection)(data));
    corrections.push(change);
    const question = open.find(
      (row) => row.kind === "ruleConflict" && row.eventId === change.eventId,
    );
    if (question) open.splice(open.indexOf(question), 1);
    return { ...market, ...change, version: market.version + 1 };
  });
  return {
    answers,
    corrections,
    // Holds every later read of the questions until the returned function runs.
    holdReads: () => {
      let release = () => {};
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        gate = null;
        release();
      };
    },
  };
}

function Screen() {
  const { data: summary } = useSuspenseQuery(
    questionSummaryQuery({ currency: "AUD", period: null }),
  );
  return (
    <QuestionsPage
      input={{ currency: "AUD", filter: null, period: null }}
      summary={summary}
      periodLabel={null}
      references={references}
      onFilter={() => {}}
    >
      {null}
    </QuestionsPage>
  );
}

async function renderQuestions(onTestFinished: (cleanup: () => Promise<void>) => void) {
  const root = createRootRoute({
    component: () => (
      <Suspense fallback={<p>Loading</p>}>
        <Screen />
      </Suspense>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    client.clear();
    vi.mocked(listQuestions).mockReset();
    vi.mocked(summarizeQuestions).mockReset();
    vi.mocked(previewCounterpartyChange).mockReset();
    vi.mocked(applyCounterpartyChange).mockReset();
    vi.mocked(getEventForPosting).mockReset();
    vi.mocked(previewCorrection).mockReset();
    vi.mocked(applyCorrection).mockReset();
  });
}

const headings = () =>
  page
    .getByRole("listitem")
    .getByRole("heading", { level: 2 })
    .elements()
    .map((heading) => heading.textContent);

test("Skip moves a question to the end, focuses the next one, and sends nothing", async ({
  onTestFinished,
}) => {
  const api = fakeApi([account, metro, janeDinner]);
  await renderQuestions(onTestFinished);

  const first = page.getByRole("article", { name: "Whose is the account ending 9921?" });
  await first.getByRole("button", { name: "Skip" }).click();

  await expect
    .element(page.getByRole("heading", { name: "Is “WOOLWORTHS METRO” Coles?" }))
    .toHaveFocus();
  expect(headings()).toEqual([
    "Is “WOOLWORTHS METRO” Coles?",
    "What are payments with Jane Smith marked like “dinner split”?",
    "Whose is the account ending 9921?",
  ]);
  await expect.element(page.getByText("3 questions affect", { exact: false })).toBeVisible();
  expect(api.answers).toEqual([]);
});

test("accepting a person proposal for one reference saves that reference's default and focuses the next question once the list no longer has it", async ({
  onTestFinished,
}) => {
  const api = fakeApi([janeRent, janeDinner]);
  await renderQuestions(onTestFinished);

  const card = page.getByRole("article", {
    name: "What are payments with Jane Smith marked like “Rent Aug”?",
  });
  await expect.element(card.getByText("Proposed: spending in Rent.")).toBeVisible();
  await expect
    .element(card.getByRole("radio", { name: "Only payments marked like “Rent Aug”" }))
    .toBeChecked();
  const accept = card.getByRole("button", { name: "Yes, spending in Rent" });
  await accept.click();
  const release = api.holdReads();
  await card.getByRole("button", { name: "Apply to all 2 transactions" }).click();

  await expect
    .poll(() => api.answers)
    .toEqual([
      {
        kind: "saveReference",
        counterpartyId: jane.id,
        referenceKey: "rent",
        expectedVersion: null,
        defaultRole: "purchase",
        defaultCategoryId: rent,
      },
    ]);
  await expect.element(accept).toBeDisabled();
  release();

  await expect.element(card).not.toBeInTheDocument();
  await expect
    .element(
      page.getByRole("heading", {
        name: "What are payments with Jane Smith marked like “dinner split”?",
      }),
    )
    .toHaveFocus();
});

test("More questions focuses the first question it loads", async ({ onTestFinished }) => {
  fakeApi([account, metro, janeDinner], 2);
  await renderQuestions(onTestFinished);

  await page.getByRole("button", { name: "More questions" }).click();

  await expect
    .element(
      page.getByRole("heading", {
        name: "What are payments with Jane Smith marked like “dinner split”?",
      }),
    )
    .toHaveFocus();
  await expect
    .element(page.getByRole("button", { name: "More questions" }))
    .not.toBeInTheDocument();
});

test("answering that a person's payments are income drops the spending category the proposal named", async ({
  onTestFinished,
}) => {
  const api = fakeApi([janeRent]);
  await renderQuestions(onTestFinished);

  const card = page.getByRole("article", {
    name: "What are payments with Jane Smith marked like “Rent Aug”?",
  });
  await card.getByRole("button", { name: "Something else" }).click();
  await card.getByRole("combobox", { name: "These payments are" }).click();
  await page.getByRole("option", { name: "Income", exact: true }).click();
  await expect
    .element(card.getByRole("combobox", { name: "Category", exact: true }))
    .toHaveValue("");
  await card.getByRole("button", { name: "Preview" }).click();
  await card.getByRole("button", { name: "Apply to all 2 transactions" }).click();

  await expect.element(card).not.toBeInTheDocument();
  expect(api.answers).toEqual([
    {
      kind: "saveReference",
      counterpartyId: jane.id,
      referenceKey: "rent",
      expectedVersion: null,
      defaultRole: "income",
      defaultCategoryId: null,
    },
  ]);
});

test("choosing a counterparty you have under Someone else moves the descriptor to it instead of creating another", async ({
  onTestFinished,
}) => {
  const api = fakeApi([metro, account]);
  await renderQuestions(onTestFinished);

  const card = page.getByRole("article", { name: "Is “WOOLWORTHS METRO” Coles?" });
  await card.getByRole("button", { name: "Someone else" }).click();
  await card.getByRole("combobox", { name: "Who it is" }).fill("woolworths");
  await expect.element(page.getByRole("option", { name: /Create/ })).not.toBeInTheDocument();
  await page.getByRole("option", { name: /Woolworths/ }).click();
  await card.getByRole("button", { name: "Preview" }).click();
  await card.getByRole("button", { name: "Apply to all 2 transactions" }).click();

  await expect.element(card).not.toBeInTheDocument();
  expect(api.answers).toEqual([
    {
      kind: "moveAlias",
      aliasKey: "WOOLWORTHS METRO",
      expectedVersion: 2,
      counterpartyId: woolworths.id,
      event: null,
    },
  ]);
});

test("typing the proposed counterparty's name under Someone else offers it, not a second one", async ({
  onTestFinished,
}) => {
  const api = fakeApi([metro]);
  await renderQuestions(onTestFinished);

  const card = page.getByRole("article", { name: "Is “WOOLWORTHS METRO” Coles?" });
  await card.getByRole("button", { name: "Someone else" }).click();
  await card.getByRole("combobox", { name: "Who it is" }).fill("coles");
  await expect.element(page.getByRole("option", { name: /Create/ })).not.toBeInTheDocument();
  await page.getByRole("option", { name: /Coles/ }).click();
  await card.getByRole("button", { name: "Preview" }).click();
  await card.getByRole("button", { name: "Apply to all 2 transactions" }).click();

  await expect.element(card).not.toBeInTheDocument();
  expect(api.answers).toEqual([
    {
      kind: "moveAlias",
      aliasKey: "WOOLWORTHS METRO",
      expectedVersion: 2,
      counterpartyId: coles.id,
      event: null,
    },
  ]);
});

test("choosing a counterparty you have for one the model proposed merges the proposal into it", async ({
  onTestFinished,
}) => {
  const api = fakeApi([proposed, account]);
  await renderQuestions(onTestFinished);

  const card = page.getByRole("article", { name: "Is this Woolies?" });
  await card.getByRole("button", { name: "Something else" }).click();
  await card.getByRole("combobox", { name: "Who it is" }).fill("woolworths");
  await page.getByRole("option", { name: /Woolworths/ }).click();
  await card.getByRole("button", { name: "Preview" }).click();
  await card.getByRole("button", { name: "Apply to all 2 transactions" }).click();

  await expect.element(card).not.toBeInTheDocument();
  expect(api.answers).toEqual([
    {
      kind: "merge",
      sourceId: woolies.id,
      sourceVersion: 3,
      targetId: woolworths.id,
      targetVersion: 4,
    },
  ]);
});

test("choosing on the transaction of a rule conflict saves a correction on it and moves to the next question", async ({
  onTestFinished,
}) => {
  const api = fakeApi([conflict, account]);
  await renderQuestions(onTestFinished);

  const card = page.getByRole("article", {
    name: "Two rules disagree about “SYNTHETIC MARKET” on 3 August 2026",
  });
  await expect.element(card.getByText("Market rent sets the category to Rent")).toBeVisible();
  await card.getByRole("button", { name: "Choose on this transaction" }).click();
  await card.getByRole("combobox", { name: "Category 1" }).click();
  await page.getByRole("option", { name: "Rent" }).click();
  await card.getByRole("button", { name: "Preview correction" }).click();
  await card.getByRole("button", { name: "Save correction" }).click();

  await expect.element(card).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("heading", { name: "Whose is the account ending 9921?" }))
    .toHaveFocus();
  expect(api.corrections).toMatchObject([
    { eventId: market.id, kind: "purchase", allocations: [{ categoryId: rent }] },
  ]);
});

test("cancelling the transaction editor on a card returns focus to the button that opened it", async ({
  onTestFinished,
}) => {
  fakeApi([conflict]);
  await renderQuestions(onTestFinished);

  const card = page.getByRole("article", {
    name: "Two rules disagree about “SYNTHETIC MARKET” on 3 August 2026",
  });
  const choose = card.getByRole("button", { name: "Choose on this transaction" });
  await choose.click();
  await card.getByRole("button", { name: "Cancel" }).click();

  await expect.element(card.getByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  await expect.element(choose).toHaveFocus();
});
