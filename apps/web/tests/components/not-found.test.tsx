import { YearMonth } from "@repo/contracts/finance";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { getFactsStatus, getMonthlyFlow } from "@/features/flow/functions";
import { getPosting } from "@/features/ledger/functions";
import { summarizeQuestions } from "@/features/questions/functions";
import { getSettings } from "@/features/settings/functions";
import { AppRequestError } from "@/lib/app-error";
import { getRouter } from "@/router";
import type { callApiRpc, fetchApi } from "@/server/api-client.server";

// The route tree imports every feature's server functions, so `createServerFn` makes each
// one a mock. File routes that forward requests import the API client, which no test calls.
// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: () => ({ handler: () => vi.fn<() => Promise<void>>() }),
    handler: () => vi.fn<() => Promise<void>>(),
  }),
}));
// oxlint-disable-next-line anti-slop/no-module-mocking -- The API client is the remote transport boundary.
vi.mock("../../src/server/api-client.server", () => ({
  callApiRpc: vi.fn<typeof callApiRpc>(),
  fetchApi: vi.fn<typeof fetchApi>(),
}));

vi.mocked(getSettings).mockResolvedValue({
  timezone: "Australia/Sydney",
  reportingCurrency: "AUD",
  version: 1,
});
// Records for August 2026 only.
vi.mocked(getMonthlyFlow).mockResolvedValue([
  {
    month: YearMonth.make("2026-08"),
    inflow: { currency: "AUD", minor: 500000n },
    outflow: { currency: "AUD", minor: 300000n },
    spending: { currency: "AUD", minor: 300000n },
    modelShare: { currency: "AUD", minor: 0n },
    coverage: "complete",
  },
]);
vi.mocked(getFactsStatus).mockResolvedValue({ outdated: 0, rebuilding: false });
vi.mocked(summarizeQuestions).mockResolvedValue({
  period: null,
  count: 0,
  byFilter: { who: 0, people: 0, accounts: 0, rules: 0 },
  outflow: { currency: "AUD", minor: 0n },
  inflow: { currency: "AUD", minor: 0n },
});
// The API has no transaction with the ID asked for, as after a reimport.
vi.mocked(getPosting).mockRejectedValue(new AppRequestError("notFound", "Transaction not found."));

// The app's router, with its routes and pages, opened at an address.
async function open(address: string, onTestFinished: (cleanup: () => Promise<void>) => void) {
  const router = getRouter();
  router.update({
    ...router.options,
    history: createMemoryHistory({ initialEntries: [address] }),
  });
  const screen = await render(<RouterProvider router={router} />);
  onTestFinished(() => screen.unmount());
}

const unreadable = "This address has a value Ironcage cannot read";
const nowhere = "There is no page at this address";

test("a period that cannot be read shows only the page that says so", async ({
  onTestFinished,
}) => {
  await open("/?period=garbage", onTestFinished);

  await expect.element(page.getByRole("heading", { name: unreadable })).toBeVisible();
  await expect
    .element(page.getByRole("link", { name: "Open the overview" }))
    .toHaveAttribute("href", "/");
  await expect.element(page.getByRole("banner")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Open menu" })).not.toBeInTheDocument();
});

test("a screen's search value that cannot be read keeps the top bar but no period strip", async ({
  onTestFinished,
}) => {
  await open("/spending?period=2026-08&unspecified=true", onTestFinished);

  await expect.element(page.getByRole("heading", { name: unreadable })).toBeVisible();
  await expect.element(page.getByRole("banner")).toBeVisible();
  await expect.element(page.getByRole("navigation", { name: "Period" })).not.toBeInTheDocument();
});

test("a transaction ID that is not an ID says the address cannot be read", async ({
  onTestFinished,
}) => {
  await open("/ledger/not-an-id?period=2026-08", onTestFinished);

  await expect.element(page.getByRole("heading", { name: unreadable })).toBeVisible();
  await expect.element(page.getByRole("navigation", { name: "Period" })).not.toBeInTheDocument();
});

test("a transaction the API does not have says there is no page there", async ({
  onTestFinished,
}) => {
  await open("/ledger/00000000-0000-4000-8000-000000000002?period=2026-08", onTestFinished);

  await expect.element(page.getByRole("heading", { name: nowhere })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: unreadable })).not.toBeInTheDocument();
  await expect.element(page.getByText("This page could not load")).not.toBeInTheDocument();
  await expect.element(page.getByRole("navigation", { name: "Period" })).not.toBeInTheDocument();
});

test("an address with no screen says there is no page there", async ({ onTestFinished }) => {
  await open("/nowhere?period=2026-08", onTestFinished);

  await expect.element(page.getByRole("heading", { name: nowhere })).toBeVisible();
});

test("the period strip shows on a screen that reads the period", async ({ onTestFinished }) => {
  await open("/?period=2026-07", onTestFinished);

  await expect.element(page.getByRole("heading", { name: "July 2026" })).toBeVisible();
  await expect.element(page.getByRole("navigation", { name: "Period" })).toBeVisible();
});
