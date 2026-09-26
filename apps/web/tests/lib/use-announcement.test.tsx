import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { useAnnouncement } from "@/lib/use-announcement";

function Saver() {
  const [announcer, announce] = useAnnouncement();
  return (
    <>
      <button onClick={() => announce("Saved")}>Save</button>
      {announcer}
    </>
  );
}

test("words announced again reach the live region again, so a screen reader says them twice", async ({
  onTestFinished,
}) => {
  const screen = await render(<Saver />);
  onTestFinished(() => screen.unmount());
  const region = screen.container.querySelector('[aria-live="polite"]');
  if (!region) throw new Error("The announcer has no polite live region.");
  // A screen reader reads what is added to a live region.
  const added: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes) added.push(node.textContent ?? "");
  });
  observer.observe(region, { childList: true, subtree: true });
  onTestFinished(() => observer.disconnect());

  const save = page.getByRole("button", { name: "Save" });
  await save.click();
  await save.click();

  await expect.poll(() => added).toEqual(["Saved", "Saved"]);
});
