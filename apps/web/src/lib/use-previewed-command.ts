import { CommandId } from "@repo/contracts/finance";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { AppRequestError } from "./app-error";
import { useCommand } from "./use-command";

const isStale = (error: Error | null) => error instanceof AppRequestError && error.code === "stale";

// A change that affects money is previewed before it is applied, and applying sends the
// versions the preview read. A stale reply refreshes every query and drops the preview,
// so the next preview reads the records as they are now.
export function usePreviewedCommand<
  Request,
  Preview,
  Input extends { commandId: typeof CommandId.Type },
  Data,
>(options: {
  preview: (request: Request) => Promise<Preview>;
  apply: (input: Input) => Promise<Data>;
  // The command that applies `previewed`, the preview of `request`.
  command: (preview: {
    previewed: Preview;
    request: Request;
    commandId: typeof CommandId.Type;
  }) => Input;
  // Runs before queries refresh, so a page can leave a record the change removed.
  onApplied?: ((data: Data) => void | Promise<void>) | undefined;
}) {
  const client = useQueryClient();
  const previewing = useMutation({
    mutationFn: options.preview,
    onError: async (error) => {
      if (isStale(error)) await client.invalidateQueries();
    },
  });
  const applying = useCommand({
    mutationFn: options.apply,
    onError: (error) => {
      if (isStale(error)) previewing.reset();
    },
    onSuccess: async (data) => {
      previewing.reset();
      await options.onApplied?.(data);
      await client.invalidateQueries();
    },
  });
  const error = applying.mutation.error ?? previewing.error;
  return {
    preview: (request: Request) => {
      applying.mutation.reset();
      previewing.mutate(request);
    },
    previewed: previewing.data,
    ready: previewing.data !== undefined,
    previewing: previewing.isPending,
    confirm: () => {
      const { data, variables } = previewing;
      if (data !== undefined && variables !== undefined)
        applying.submit(
          options.command({
            previewed: data,
            request: variables,
            commandId: CommandId.make(crypto.randomUUID()),
          }),
        );
    },
    applied: applying.mutation.data,
    pending: previewing.isPending || applying.mutation.isPending,
    uncertain: applying.uncertain,
    error,
    stale: isStale(error),
    reset: () => {
      previewing.reset();
      applying.mutation.reset();
    },
  };
}

// What a dialog needs to confirm a previewed change, whatever the command.
export type PreviewedCommand = Pick<
  ReturnType<typeof usePreviewedCommand>,
  "ready" | "previewing" | "confirm" | "pending" | "uncertain" | "error"
>;
