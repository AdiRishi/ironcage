import { CounterpartyId } from "@repo/contracts/finance";
import { useState } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page, userEvent } from "vitest/browser";

import { Label } from "@/components/ui/label";
import {
  type CounterpartyChoice,
  CounterpartyCombobox,
} from "@/features/counterparties/counterparty-combobox";

const counterparties: CounterpartyChoice[] = [
  {
    id: CounterpartyId.make("00000000-0000-4000-8000-000000000001"),
    name: "Woolworths",
    kind: "business",
    version: 1,
  },
  {
    id: CounterpartyId.make("00000000-0000-4000-8000-000000000002"),
    name: "Coles",
    kind: "business",
    version: 1,
  },
];

function Picker() {
  const [value, setValue] = useState<CounterpartyChoice | null>(null);
  return (
    <form>
      <Label htmlFor="who">Who is this</Label>
      <CounterpartyCombobox
        id="who"
        counterparties={counterparties}
        excluding={null}
        value={value?.id ?? null}
        onValueChange={setValue}
      />
      <button type="submit">Save</button>
    </form>
  );
}

test("the counterparty picker is one tab stop, and a click on it lists the counterparties", async ({
  onTestFinished,
}) => {
  const screen = await render(<Picker />);
  onTestFinished(() => screen.unmount());
  const input = page.getByRole("combobox", { name: "Who is this" });

  await userEvent.click(input);
  await expect.element(page.getByRole("option", { name: /Coles/ })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await userEvent.tab();
  await expect.element(page.getByRole("button", { name: "Save" })).toHaveFocus();
});
