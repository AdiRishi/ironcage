import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

test("body text, shadcn tables, and controls set their text in the Body role, 15 on 24 pixels", async ({
  onTestFinished,
}) => {
  const screen = await render(
    <>
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>Dining out</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Button>Preview</Button>
    </>,
  );
  onTestFinished(() => screen.unmount());

  for (const element of [
    document.body,
    page.getByRole("cell", { name: "Dining out" }).element(),
    page.getByRole("button", { name: "Preview" }).element(),
  ]) {
    const style = getComputedStyle(element);
    expect([style.fontSize, style.lineHeight]).toEqual(["15px", "24px"]);
  }
});
