import { YearMonth } from "@repo/contracts/finance";
import { shiftYearMonth } from "@repo/finance";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { MonthRangePicker } from "@/components/shell/month-range-picker";
import { type PeriodKey, resolvePeriodKey } from "@/lib/period";

const months = Array.from({ length: 17 }, (_, index) =>
  shiftYearMonth(YearMonth.make("2025-01"), index),
);

async function choose(from: string, through: string) {
  await page.getByRole("button", { name: "Choose months" }).click();
  await page.getByRole("combobox", { name: "From" }).click();
  await page.getByRole("option", { name: from }).click();
  await page.getByRole("combobox", { name: "Through" }).click();
  await page.getByRole("option", { name: through }).click();
  await page.getByRole("button", { name: "Show these months" }).click();
}

function renderPicker(onChange: (key: PeriodKey) => void) {
  return render(
    <MonthRangePicker
      months={months}
      period={resolvePeriodKey(YearMonth.make("2026-05"), "Australia/Sydney")}
      onChange={onChange}
    />,
  );
}

test("months chosen backwards are refused", async ({ onTestFinished }) => {
  const onChange = vi.fn<(key: PeriodKey) => void>();
  const screen = await renderPicker(onChange);
  onTestFinished(() => screen.unmount());

  await choose("May 2026", "March 2026");

  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Choose a first month on or before the last.");
  expect(onChange).not.toHaveBeenCalled();
});

test("a whole calendar year is written as the year", async ({ onTestFinished }) => {
  const onChange = vi.fn<(key: PeriodKey) => void>();
  const screen = await renderPicker(onChange);
  onTestFinished(() => screen.unmount());

  await choose("January 2025", "December 2025");

  expect(onChange).toHaveBeenCalledWith(2025);
});
