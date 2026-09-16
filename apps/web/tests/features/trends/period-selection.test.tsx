import { CalendarDate, type OverviewInput } from "@repo/contracts/finance";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { OverviewSelection } from "@/features/analysis/selection";

test("fixed dates can be edited across the old period boundary before applying", async ({
  onTestFinished,
}) => {
  const selected: OverviewInput[] = [];
  const period = {
    start: CalendarDate.make("2026-08-01"),
    endExclusive: CalendarDate.make("2026-09-01"),
  };
  const screen = await render(
    <OverviewSelection
      input={{
        period: { kind: "fixed", ...period },
        basis: "spending",
        currency: "AUD",
        accounts: [],
      }}
      accounts={[]}
      resolvedPeriod={period}
      onApply={async (input) => {
        selected.push(input);
      }}
    />,
  );
  onTestFinished(() => screen.unmount());
  await screen.getByLabelText("Start", { exact: true }).fill("2026-10-01");
  await screen.getByLabelText("End, excluded", { exact: true }).fill("2026-11-01");
  await screen.getByRole("button", { name: "Apply period" }).click();
  await expect
    .poll(() => selected.at(-1)?.period)
    .toEqual({ kind: "fixed", start: "2026-10-01", endExclusive: "2026-11-01" });
});
