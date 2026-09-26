import { type Briefing, type Figure, FigureId } from "@repo/contracts/analyst";
import { AccountId, CalendarDate, Instant, YearMonth } from "@repo/contracts/finance";
import { expect, test, vi } from "vitest";
import { page } from "vitest/browser";

import {
  getBriefing,
  listBriefings,
  listConversations,
  requestBriefing,
} from "@/features/analyst/functions";
import { getReferenceData } from "@/features/events/functions";
import { getFactsStatus, getMonthlyFlow, getPeriodFlow } from "@/features/flow/functions";
import { getModelSettings } from "@/features/models/functions";
import { summarizeQuestions } from "@/features/questions/functions";
import { getSettings } from "@/features/settings/functions";
import { AppRequestError } from "@/lib/app-error";
import type { callAnalystRpc } from "@/server/analyst-client.server";
import type { callApiRpc, fetchApi } from "@/server/api-client.server";

import { openApp } from "../../support/app";
import { august as augustFlow } from "../overview/period-flow";

// These tests run the app's own routes, so `createServerFn` makes every server function a
// mock. Server functions and the file routes that forward requests import the API and
// analyst clients, which no test calls.
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
const august = YearMonth.make("2026-08");
const augustMonths = { kind: "months", from: august, to: august } as const;
const writtenAt = Instant.make("2026-09-01T00:30:00.000Z");
const days = (start: string, endExclusive: string) => ({
  start: CalendarDate.make(start),
  endExclusive: CalendarDate.make(endExclusive),
});
const figure = (
  id: string,
  label: string,
  value: Figure["value"],
  records: Figure["records"],
): Figure => ({
  id: FigureId.make(id),
  label,
  value,
  basis: "spending",
  calculatedAt: writtenAt,
  modelAmount: null,
  records,
});

// August 2026's briefing: $9,000 came in, spending rose $100 from July, and 2 questions
// need an answer. Each figure opens the screen that shows it.
const ready: Briefing = {
  month: august,
  status: "ready",
  sections: {
    cameIn: "[[f1]] came in during August 2026, most of it salary.",
    wentOut: "Housing and Food took most of the spending in August 2026.",
    changed: "Spending rose [[f2]] from July 2026.",
    needsAnswer: "[[f3]] from August 2026 need an answer.",
  },
  figures: [
    figure(
      "f1",
      "Came in, August 2026",
      { kind: "money", amount: money(900000n), signed: false },
      { kind: "overview", period: augustMonths, comparison: { kind: "previous" } },
    ),
    figure(
      "f2",
      "Spending, change from July 2026 to August 2026",
      { kind: "money", amount: money(10000n), signed: true },
      {
        kind: "spending",
        period: augustMonths,
        comparison: { kind: "previous" },
        category: { kind: "all" },
        counterparty: { kind: "all" },
      },
    ),
    figure(
      "f3",
      "Open questions in August 2026",
      { kind: "count", count: 2, unit: "question" },
      { kind: "questions", period: augustMonths },
    ),
  ],
  records: [],
  basis: {
    periods: [
      { period: days("2026-08-01", "2026-09-01"), comparison: days("2026-07-01", "2026-08-01") },
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
    calculatedAt: writtenAt,
  },
  limits: [],
  writtenAt,
};
const unwritten = (status: "writing" | "none", month = august): Briefing => ({ month, status });
const failure = "The analyst could not reach the model. Write the briefing again in a few minutes.";
const writing = "The analyst is writing August 2026's briefing from your latest records.";

const provider = {
  name: "Cloudflare Workers AI",
  model: "@cf/zai-org/glm-5.3-flash",
  inputMicrousdPerMillion: 150_000n,
  cachedInputMicrousdPerMillion: 30_000n,
  outputMicrousdPerMillion: 500_000n,
};

// The API and the analyst as far as these tests go: records for July and August 2026, the
// flow of August, the analyst on or off, August's briefing as `stored` holds it, and no
// briefing of any other month. Asking for a write queues it.
let stored: Briefing;
function serve(briefing: Briefing, { analyst = true } = {}) {
  stored = briefing;
  vi.mocked(getSettings).mockResolvedValue({
    timezone: "Australia/Sydney",
    reportingCurrency: "AUD",
    version: 1,
  });
  vi.mocked(getMonthlyFlow).mockResolvedValue(
    ["2026-07", "2026-08"].map((month) => ({
      month: YearMonth.make(month),
      inflow: money(900000n),
      outflow: money(526000n),
      spending: money(216000n),
      modelShare: money(0n),
      coverage: "complete",
    })),
  );
  vi.mocked(getFactsStatus).mockResolvedValue({ outdated: 0, rebuilding: false });
  vi.mocked(getPeriodFlow).mockResolvedValue(augustFlow);
  vi.mocked(summarizeQuestions).mockResolvedValue({
    period: null,
    count: 0,
    byFilter: { who: 0, people: 0, accounts: 0, rules: 0 },
    outflow: money(0n),
    inflow: money(0n),
  });
  vi.mocked(getModelSettings).mockResolvedValue({
    enrichment: { enabled: false, autoApplyConfidence: 0.8, provider },
    analyst: { enabled: analyst, provider },
    warning: null,
    version: 1,
  });
  vi.mocked(getReferenceData).mockResolvedValue({
    categories: [],
    counterparties: [],
    tags: [],
    personalEvents: [],
  });
  vi.mocked(listConversations).mockResolvedValue({ rows: [], nextCursor: null });
  vi.mocked(getBriefing).mockImplementation(async ({ data }) =>
    data.month === august ? stored : unwritten("none", YearMonth.make(data.month)),
  );
  vi.mocked(requestBriefing).mockImplementation(async () => {
    stored = unwritten("writing");
    return stored;
  });
  vi.mocked(listBriefings).mockImplementation(async () =>
    stored.status === "none" ? [] : [{ month: august, status: "ready", writtenAt }],
  );
}

const briefingSection = () => page.getByRole("region", { name: "The analyst's briefing" });

test("August's briefing sits between the headline and the flow, each figure a link to its records", async ({
  onTestFinished,
}) => {
  serve(ready);
  await openApp("/?period=2026-08", onTestFinished);

  const briefing = briefingSection();
  await expect
    .element(briefing.getByRole("heading", { name: "What changed from July 2026" }))
    .toBeVisible();
  await expect
    .element(briefing.getByRole("link", { name: /^\$9,000\.00/ }))
    .toHaveAttribute("href", "/?period=2026-08");
  await expect
    .element(briefing.getByRole("link", { name: /^\+\$100\.00/ }))
    .toHaveAttribute("href", "/spending?period=2026-08");
  await expect
    .element(briefing.getByRole("link", { name: /^2 questions/ }))
    .toHaveAttribute("href", "/questions?scope=period&period=2026-08");
  await expect
    .element(briefing.getByText(/^Based on August 2026 compared with July 2026/))
    .toMatchTextContent(/by spending date, in AUD, from Everyday\./);
  const title = page.getByRole("heading", { level: 1, name: "August 2026" }).element();
  const flow = page.getByRole("region", { name: "Where it came from and where it went" }).element();
  expect(title.compareDocumentPosition(briefing.element())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(briefing.element().compareDocumentPosition(flow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("Ask about this briefing opens a new question about August's briefing", async ({
  onTestFinished,
}) => {
  serve(ready);
  const router = await openApp("/?period=2026-08", onTestFinished);

  await briefingSection().getByRole("link", { name: "Ask about this briefing" }).click();

  await expect
    .element(page.getByRole("button", { name: "Ask without The briefing for August 2026" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "The briefing for August 2026" }))
    .toHaveAttribute("href", "/?period=2026-08");
  expect(router.state.location.pathname).toBe("/analyst");
  expect(router.state.location.search).toEqual({
    period: "2026-08",
    about: { kind: "briefing", month: "2026-08" },
  });
});

test("a briefing being written says so, then shows once the analyst has written it", async ({
  onTestFinished,
}) => {
  serve(unwritten("writing"));
  await openApp("/?period=2026-08", onTestFinished);

  await expect.element(briefingSection().getByText(writing)).toBeVisible();
  stored = ready;

  await expect
    .element(briefingSection().getByRole("link", { name: /^\$9,000\.00/ }), { timeout: 3000 })
    .toBeVisible();
  await expect.element(page.getByText("Briefing ready")).toBeInTheDocument();
});

test("a briefing whose write fails says why, and a screen reader hears that it could not be written", async ({
  onTestFinished,
}) => {
  serve(unwritten("writing"));
  await openApp("/?period=2026-08", onTestFinished);

  await expect.element(briefingSection().getByText(writing)).toBeVisible();
  stored = { month: august, status: "failed", message: failure };

  await expect.element(briefingSection().getByText(failure), { timeout: 3000 }).toBeVisible();
  await expect.element(page.getByText("The briefing could not be written")).toBeInTheDocument();
  await expect
    .element(briefingSection().getByRole("button", { name: "Write it again" }))
    .toBeVisible();
});

test("Write the briefing asks the analyst for it, and focus moves to the line that says it is writing", async ({
  onTestFinished,
}) => {
  serve(unwritten("none"));
  await openApp("/?period=2026-08", onTestFinished);

  const write = briefingSection().getByRole("button", { name: "Write the briefing" });
  await expect
    .element(briefingSection().getByText("The analyst has not written a briefing of August 2026."))
    .toBeVisible();
  await write.click();

  const line = briefingSection().getByText(writing);
  await expect.element(line).toBeVisible();
  await expect.poll(() => document.activeElement?.contains(line.element())).toBe(true);
});

const recalculating =
  "Ironcage is recalculating totals after an update. Write the briefing once it finishes.";

test("a briefing that cannot be written yet says why and keeps focus on its button", async ({
  onTestFinished,
}) => {
  serve(unwritten("none"));
  vi.mocked(requestBriefing).mockRejectedValue(new AppRequestError("unavailable", recalculating));
  await openApp("/?period=2026-08", onTestFinished);

  const write = briefingSection().getByRole("button", { name: "Write the briefing" });
  await write.click();

  await expect.element(page.getByText(recalculating)).toBeVisible();
  await expect.element(write).toHaveFocus();
});

test("another month's briefing starts afresh, without the reason a write of the last one was refused", async ({
  onTestFinished,
}) => {
  serve(unwritten("none"));
  vi.mocked(requestBriefing).mockRejectedValue(new AppRequestError("unavailable", recalculating));
  const router = await openApp("/?period=2026-07", onTestFinished);
  const july = briefingSection().getByText("The analyst has not written a briefing of July 2026.");
  await expect.element(july).toBeVisible();

  await router.navigate({ to: "/", search: { period: august } });
  await briefingSection().getByRole("button", { name: "Write the briefing" }).click();
  await expect.element(page.getByText(recalculating)).toBeVisible();
  await router.navigate({ to: "/", search: { period: YearMonth.make("2026-07") } });

  await expect.element(july).toBeVisible();
  await expect.element(page.getByText(recalculating)).not.toBeInTheDocument();
});

test("a briefing the analyst could not write says why, and Write it again asks for it again", async ({
  onTestFinished,
}) => {
  serve({ month: august, status: "failed", message: failure });
  await openApp("/?period=2026-08", onTestFinished);

  await expect.element(briefingSection().getByText(failure)).toBeVisible();
  await briefingSection().getByRole("button", { name: "Write it again" }).click();

  await expect.element(briefingSection().getByText(writing)).toBeVisible();
  await expect.element(briefingSection().getByText(failure)).not.toBeInTheDocument();
});

test("a briefing blocked at the usage warning says so and links to Settings, with nothing to write", async ({
  onTestFinished,
}) => {
  const warning = "Model usage reached the warning in Settings. Raise it to continue.";
  serve({ month: august, status: "blocked", message: warning });
  await openApp("/?period=2026-08", onTestFinished);

  await expect.element(briefingSection().getByText(warning)).toBeVisible();
  await expect
    .element(briefingSection().getByRole("link", { name: "Open Settings" }))
    .toHaveAttribute("href", "/settings?period=2026-08");
  await expect.element(briefingSection().getByRole("button")).not.toBeInTheDocument();
});

test("the overview shows its figures and flow while the briefing is still loading", async ({
  onTestFinished,
}) => {
  serve(ready);
  vi.mocked(getBriefing).mockReturnValue(new Promise(() => {}));
  await openApp("/?period=2026-08", onTestFinished);

  await expect
    .element(page.getByRole("heading", { name: "Where it came from and where it went" }))
    .toBeVisible();
  await expect.element(page.getByRole("heading", { level: 1, name: "August 2026" })).toBeVisible();
  await expect.element(briefingSection().getByText("Reading the briefing…")).toBeVisible();
});

test("a briefing that cannot be read says why, and Retry reads it again", async ({
  onTestFinished,
}) => {
  serve(ready);
  vi.mocked(getBriefing).mockRejectedValueOnce(
    new AppRequestError("internal", "The request could not be completed."),
  );
  await openApp("/?period=2026-08", onTestFinished);

  await expect
    .element(briefingSection().getByRole("alert"))
    .toMatchTextContent(/^The request could not be completed\. Retry$/);
  await briefingSection().getByRole("button", { name: "Retry" }).click();

  await expect.element(briefingSection().getByRole("link", { name: /^\$9,000\.00/ })).toBeVisible();
  await expect.element(briefingSection().getByRole("alert")).not.toBeInTheDocument();
});

test("while the analyst is off, the overview has no briefing", async ({ onTestFinished }) => {
  serve(ready, { analyst: false });
  await openApp("/?period=2026-08", onTestFinished);

  await expect
    .element(page.getByRole("heading", { name: "Where it came from and where it went" }))
    .toBeVisible();
  await expect.element(briefingSection()).not.toBeInTheDocument();
});

test("the analyst screen lists the latest briefings, each opening its month's overview at the briefing", async ({
  onTestFinished,
}) => {
  serve(ready);
  const router = await openApp("/analyst?period=2026-07", onTestFinished);

  const listed = page
    .getByRole("region", { name: "Briefings" })
    .getByRole("link", { name: /^August 2026/ });
  await expect.element(listed).toMatchTextContent(/Written 1 Sept 2026, 10:30 am$/);
  await expect.element(listed).toHaveAttribute("href", "/?period=2026-08#briefing");
  await listed.click();

  await expect.element(briefingSection().getByRole("link", { name: /^\$9,000\.00/ })).toBeVisible();
  expect(document.getElementById(router.state.location.hash)).toBe(briefingSection().element());
});

test("while the analyst is off, the analyst screen lists no briefings", async ({
  onTestFinished,
}) => {
  serve(ready, { analyst: false });
  await openApp("/analyst?period=2026-08", onTestFinished);

  await expect.element(page.getByText(/^The analyst is off\./)).toBeVisible();
  await expect.element(page.getByRole("region", { name: "Briefings" })).not.toBeInTheDocument();
});
