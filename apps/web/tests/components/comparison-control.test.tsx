import { CalendarDate, YearMonth } from "@repo/contracts/finance";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { ComparisonControl } from "@/components/comparison-control";
import { type ComparisonKey, resolvePeriodKey } from "@/lib/period";

const day = (value: string) => CalendarDate.make(value);

function renderControl({
  month,
  current,
  comparison,
  value,
  onChange = () => {},
}: {
  month: string;
  current: readonly [string, string];
  comparison: readonly [string, string];
  value?: ComparisonKey;
  onChange?: (value: ComparisonKey | undefined) => void;
}) {
  return render(
    <ComparisonControl
      period={resolvePeriodKey(YearMonth.make(month), "Australia/Sydney")}
      current={{ start: day(current[0]), endExclusive: day(current[1]) }}
      comparison={{ start: day(comparison[0]), endExclusive: day(comparison[1]) }}
      value={value}
      onChange={onChange}
      firstMonth={YearMonth.make("2025-01")}
      today={day("2026-09-25")}
    />,
  );
}
const wholeApril = {
  month: "2026-04",
  current: ["2026-04-01", "2026-05-01"],
  comparison: ["2026-03-01", "2026-04-01"],
} as const;
const choose = () => page.getByRole("button", { name: /Choose another comparison$/ }).click();

test("chosen dates compare with exactly the days picked, east of UTC too", async ({
  onTestFinished,
}) => {
  const onChange = vi.fn<(value: ComparisonKey | undefined) => void>();
  const screen = await renderControl({ ...wholeApril, onChange });
  onTestFinished(() => screen.unmount());

  await choose();
  await page.getByRole("radio", { name: "Chosen dates" }).click();
  await page.getByRole("button", { name: /^Sunday, 1 March 2026/ }).click();
  await page.getByRole("button", { name: /^Tuesday, 14 April 2026/ }).click();
  await page.getByRole("button", { name: "Compare", exact: true }).click();

  expect(onChange).toHaveBeenCalledWith("2026-03-01..2026-04-14");
});

test("chosen dates can be picked with the arrow keys", async ({ onTestFinished }) => {
  const onChange = vi.fn<(value: ComparisonKey | undefined) => void>();
  const screen = await renderControl({ ...wholeApril, onChange });
  onTestFinished(() => screen.unmount());

  await choose();
  await page.getByRole("radio", { name: "Chosen dates" }).click();
  await page.getByRole("button", { name: /^Sunday, 1 March 2026/ }).click();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
  await page.getByRole("button", { name: "Compare", exact: true }).click();

  expect(onChange).toHaveBeenCalledWith("2026-03-01..2026-03-15");
});

test("days after today cannot be chosen", async ({ onTestFinished }) => {
  const screen = await renderControl({
    month: "2026-09",
    current: ["2026-09-01", "2026-09-26"],
    comparison: ["2026-08-01", "2026-08-26"],
  });
  onTestFinished(() => screen.unmount());

  await choose();
  await page.getByRole("radio", { name: "Chosen dates" }).click();

  await expect
    .element(page.getByRole("button", { name: /Friday, 25 September 2026/ }))
    .toBeEnabled();
  await expect
    .element(page.getByRole("button", { name: /^Saturday, 26 September 2026/ }))
    .toBeDisabled();
});

test("the same period last year is chosen by name", async ({ onTestFinished }) => {
  const onChange = vi.fn<(value: ComparisonKey | undefined) => void>();
  const screen = await renderControl({ ...wholeApril, onChange });
  onTestFinished(() => screen.unmount());

  await expect
    .element(
      page.getByRole("button", { name: "Compared with March 2026. Choose another comparison" }),
    )
    .toBeVisible();
  await choose();
  await expect.element(page.getByRole("dialog", { name: "Compare with" })).toBeVisible();
  await page.getByRole("radio", { name: /The same period last year/ }).click();
  await expect.element(page.getByText("April 2025")).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();

  expect(onChange).toHaveBeenCalledWith("lastYear");
});

test("a month in progress says how many days it has and compares with the same days", async ({
  onTestFinished,
}) => {
  const screen = await renderControl({
    month: "2026-09",
    current: ["2026-09-01", "2026-09-26"],
    comparison: ["2026-08-01", "2026-08-26"],
  });
  onTestFinished(() => screen.unmount());

  await expect
    .element(page.getByRole("paragraph"))
    .toHaveTextContent("25 days so far, compared with the same days of August 2026");
  await expect
    .element(
      page.getByRole("button", {
        name: "Compared with the same days of August 2026. Choose another comparison",
      }),
    )
    .toBeVisible();
});

test("a month in progress compares with chosen dates as chosen", async ({ onTestFinished }) => {
  const screen = await renderControl({
    month: "2026-09",
    current: ["2026-09-01", "2026-09-26"],
    comparison: ["2026-03-01", "2026-04-15"],
    value: "2026-03-01..2026-04-14",
  });
  onTestFinished(() => screen.unmount());

  const line = page.getByRole("paragraph");
  await expect
    .element(line)
    .toHaveTextContent("25 days so far, compared with 1 March to 14 April 2026");
  await expect.element(line).not.toHaveTextContent("same days");
});
