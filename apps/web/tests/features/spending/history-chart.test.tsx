import { type CoverageState, YearMonth } from "@repo/contracts/finance";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { HistoryChart } from "@/features/spending/history-chart";
import { resolvePeriodKey } from "@/lib/period";

// Records start in October 2025, and December 2025 lacks the card statement.
const months = [
  ["2025-08", 0n, "missing"],
  ["2025-09", 0n, "missing"],
  ["2025-10", 60000n, "complete"],
  ["2025-11", 80000n, "complete"],
  ["2025-12", 40000n, "partial"],
  ["2026-01", 70000n, "complete"],
  ["2026-02", 50000n, "complete"],
  ["2026-03", 65000n, "complete"],
  ["2026-04", 55000n, "complete"],
  ["2026-05", 75000n, "complete"],
  ["2026-06", 45000n, "complete"],
  ["2026-07", 60000n, "complete"],
] satisfies [string, bigint, CoverageState][];

// The mark a month is drawn with: whatever inside it has a border or a fill.
function mark(month: string) {
  const item = page
    .getByRole("listitem")
    .filter({ hasText: `${month}:` })
    .element();
  const drawn = [...item.querySelectorAll("span")].find((span) => {
    const style = getComputedStyle(span);
    return style.borderTopWidth !== "0px" || style.backgroundColor !== "rgba(0, 0, 0, 0)";
  });
  if (!drawn) throw new Error(`${month} is not drawn`);
  return { style: getComputedStyle(drawn), height: drawn.getBoundingClientRect().height };
}

test("months without records are outlined and read as no records, months with some missing are outlined at their height, and the table lists the same twelve months", async ({
  onTestFinished,
}) => {
  const screen = await render(
    <HistoryChart
      label="Dining out"
      months={months.map(([month, minor, coverage]) => ({
        month: YearMonth.make(month),
        amount: { currency: "AUD", minor },
        coverage,
      }))}
      color="var(--category-2)"
      period={resolvePeriodKey(YearMonth.make("2026-07"), "Australia/Sydney")}
    />,
  );
  onTestFinished(() => screen.unmount());

  await expect
    .element(page.getByText("August 2025: no records", { exact: true }))
    .toBeInTheDocument();
  expect(mark("August 2025").style.borderTopStyle).toBe("dashed");
  await expect
    .element(page.getByText("December 2025: $400, some records missing", { exact: true }))
    .toBeInTheDocument();
  const partial = mark("December 2025");
  expect(partial.style.borderTopStyle).toBe("solid");
  expect(partial.style.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  expect(partial.height).toBeCloseTo(mark("November 2025").height / 2, 0);

  await page.getByRole("button", { name: "Show as a table" }).click();
  const rows = page.getByRole("row").elements().slice(1);
  expect(rows.map((row) => [...row.children].map((cell) => cell.textContent))).toEqual([
    ["August 2025", "no records"],
    ["September 2025", "no records"],
    ["October 2025", "$600"],
    ["November 2025", "$800"],
    ["December 2025", "$400, some records missing"],
    ["January 2026", "$700"],
    ["February 2026", "$500"],
    ["March 2026", "$650"],
    ["April 2026", "$550"],
    ["May 2026", "$750"],
    ["June 2026", "$450"],
    ["July 2026", "$600"],
  ]);
});
