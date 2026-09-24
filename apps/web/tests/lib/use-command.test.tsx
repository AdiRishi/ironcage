import { CommandId } from "@repo/contracts/finance";
import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { createQueryClient } from "@/lib/query-client";
import { serverFnFetch } from "@/lib/server-fn-fetch";
import { useCommand } from "@/lib/use-command";

type Save = { commandId: typeof CommandId.Type; label: string; expectedVersion: number };

function Editor({ save }: { save: (input: Save) => Promise<string> }) {
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
            expectedVersion: 1,
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

test("retry after a lost fetch response preserves the committed command and its original input", async ({
  onTestFinished,
}) => {
  const receipts = new Map<string, string>();
  const records: string[] = [];
  const originalFetch = globalThis.fetch;
  const transport = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (input === "/test-command-response") return Promise.reject(new TypeError("Failed to fetch"));
    return originalFetch(input, init);
  });
  onTestFinished(() => {
    transport.mockRestore();
  });
  async function save(input: Save) {
    const receipt = receipts.get(input.commandId);
    if (receipt) return receipt;
    records.push(input.label);
    receipts.set(input.commandId, input.label);
    await serverFnFetch("/test-command-response");
    return input.label;
  }
  const client = createQueryClient();
  const screen = await render(
    <QueryClientProvider client={client}>
      <Editor save={save} />
    </QueryClientProvider>,
  );
  await screen.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The connection was lost. Please try again.");
  await screen.getByRole("textbox", { name: "Name" }).fill("Changed after failure");
  await screen.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Everyday");
  expect(records).toEqual(["Everyday"]);
  await screen.unmount();
  client.clear();
});
