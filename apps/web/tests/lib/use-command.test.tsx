import { AppRequestError } from "@repo/contracts/app";
import { CommandId } from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { createQueryClient } from "@/lib/query-client";
import { useCommand } from "@/lib/use-command";

type Save = { commandId: typeof CommandId.Type; label: string; expectedVersion: number };

function Editor({
  save,
  version = 1,
}: {
  save: (input: Save) => Promise<string>;
  version?: number;
}) {
  const [label, setLabel] = useState("Everyday");
  const { mutation, submit, uncertain } = useCommand({ mutationFn: save });
  return (
    <>
      <label>
        Name
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <button
        disabled={mutation.isPending}
        onClick={() =>
          submit({
            commandId: CommandId.make(crypto.randomUUID()),
            label,
            expectedVersion: version,
          })
        }
      >
        {uncertain ? "Retry" : "Save"}
      </button>
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      {mutation.isSuccess && <output>{mutation.data}</output>}
    </>
  );
}

test("retry after a lost response preserves the committed command and its original input", async () => {
  const receipts = new Map<string, string>();
  const records: string[] = [];
  async function save(input: Save) {
    const receipt = receipts.get(input.commandId);
    if (receipt) return receipt;
    records.push(input.label);
    receipts.set(input.commandId, input.label);
    throw new AppRequestError("unavailable", "The response was lost.");
  }
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <Editor save={save} />
    </QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("The response was lost.");
  await screen.getByRole("textbox", { name: "Name" }).fill("Changed after failure");
  await screen.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Everyday");
  expect(records).toEqual(["Everyday"]);
  await screen.unmount();
  client.clear();
});

test("a stale edit can submit the retained input with the refreshed version", async () => {
  const rejected = new Set<string>();
  let saved: Save | undefined;
  async function save(input: Save) {
    if (input.expectedVersion !== 2) {
      rejected.add(input.commandId);
      throw new AppRequestError("stale", "Refresh this record.");
    }
    if (rejected.has(input.commandId)) throw new Error("A changed command reused its ID.");
    saved = input;
    return input.label;
  }
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <Editor save={save} />
    </QueryClientProvider>,
  );
  await screen.getByRole("textbox", { name: "Name" }).fill("Savings");
  await screen.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Refresh this record.");
  await screen.rerender(
    <QueryClientProvider client={client}>
      <Editor save={save} version={2} />
    </QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Savings");
  expect(saved).toMatchObject({ label: "Savings", expectedVersion: 2 });
  await screen.unmount();
  client.clear();
});
