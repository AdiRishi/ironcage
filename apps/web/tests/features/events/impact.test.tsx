import { CalendarDate, Instant, type MeasureImpact } from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { ChangeDialog } from "@/components/change-dialog";
import { Button } from "@/components/ui/button";
import { ChangePreview } from "@/features/counterparties/change-preview";
import { getRetention, getSettings } from "@/features/settings/functions";
import { createQueryClient } from "@/lib/query-client";

// oxlint-disable-next-line anti-slop/no-module-mocking -- Server functions are the remote transport boundary.
vi.mock("../../../src/features/settings/functions", () => ({
  getSettings: vi.fn<typeof getSettings>(),
  getRetention: vi.fn<typeof getRetention>(),
}));

const money = (minor: bigint) => ({ currency: "AUD", minor });
const measures = (spending: bigint, unresolvedOut: bigint) => ({
  inflow: money(500000n),
  outflow: money(spending + unresolvedOut),
  spending: money(spending),
  income: money(500000n),
  internal: money(0n),
  loanPrincipal: money(0n),
  unresolvedOut: money(unresolvedOut),
  unresolvedIn: money(0n),
  modelShare: money(0n),
});
// A counterparty paid $45.60 every month from September 2025 to September 2026, now
// understood as spending. Calculated at 4:32 pm on 25 September 2026 in Sydney.
const impacts: (typeof MeasureImpact.Type)[] = Array.from({ length: 13 }, (_, index) => {
  const month = (offset: number) => {
    const at = 8 + index + offset;
    return `${2025 + Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}-01`;
  };
  return {
    start: CalendarDate.make(month(0)),
    endExclusive: CalendarDate.make(month(1)),
    basis: "spending",
    currency: "AUD",
    calculatedAt: Instant.make("2026-09-25T06:32:00.000Z"),
    before: measures(1234500n, 4560n),
    after: measures(1239060n, 0n),
  };
});

test("a change across thirteen months shows one table of what moves, which fits a phone dialog", async ({
  onTestFinished,
}) => {
  await page.viewport(390, 844);
  vi.mocked(getSettings).mockResolvedValue({
    timezone: "Australia/Sydney",
    reportingCurrency: "AUD",
    version: 1,
  });
  const screen = await render(
    <QueryClientProvider client={createQueryClient()}>
      <ChangeDialog
        open
        onOpenChange={() => {}}
        trigger={<Button>Move</Button>}
        title="Move WOOLWORTHS METRO to Woolworths?"
        change={{
          ready: true,
          previewing: false,
          confirm: () => {},
          pending: false,
          uncertain: false,
          error: null,
        }}
        confirmLabel="Move it"
      >
        <ChangePreview eventCount={13} impacts={impacts} />
      </ChangeDialog>
    </QueryClientProvider>,
  );
  onTestFinished(async () => {
    await screen.unmount();
    vi.mocked(getSettings).mockReset();
  });

  const dialog = page.getByRole("dialog");
  await expect
    .element(dialog.getByRole("heading", { name: "Effect on September 2025 to September 2026" }))
    .toBeVisible();
  await expect
    .element(dialog.getByText("By spending date · AUD · Calculated 25 Sept 2026, 4:32 pm"))
    .toBeVisible();
  const moved = dialog.getByRole("table", { name: "Totals this change moves" });
  await expect.element(moved).toBeVisible();
  expect(dialog.getByRole("table").elements()).toHaveLength(1);
  // A row group per month, with only the two totals that move.
  await expect.element(moved.getByText("March 2026", { exact: true })).toBeVisible();
  expect(moved.getByRole("rowheader", { name: "Spending" }).elements()).toHaveLength(13);
  expect(moved.getByRole("rowheader", { name: "Out, not yet understood" }).elements()).toHaveLength(
    13,
  );
  expect(moved.getByRole("rowheader", { name: "Came in" }).elements()).toHaveLength(0);
  const [spending] = moved.getByRole("row", { name: /^Spending/ }).elements();
  expect(spending?.textContent).toBe("Spending$12,345.00$12,390.60");
  const scroller = moved.element().parentElement;
  expect(scroller?.scrollWidth).toBeLessThanOrEqual(scroller?.clientWidth ?? 0);

  await userEvent.click(dialog.getByRole("button", { name: "Every total, month by month" }));
  const every = dialog.getByRole("table", { name: "Every total, month by month" });
  await expect.element(every).toBeVisible();
  expect(every.getByRole("rowheader", { name: "Came in" }).elements()).toHaveLength(13);
});
