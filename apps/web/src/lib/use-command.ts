import { CommandId } from "@repo/contracts/finance";
import { useMutation, useQueryClient, type UseMutationOptions } from "@tanstack/react-query";

import { AppRequestError } from "./app-error";

// Whether a command failed without a reply, so it may have applied.
export const outcomeUnknown = (error: Error | null) =>
  error instanceof AppRequestError && error.code === "unavailable";

// A lost response leaves the outcome unknown, so the retry resends the same
// command ID and input rather than whatever the form holds now.
export function useCommand<Input extends { commandId: typeof CommandId.Type }, Data>(
  options: UseMutationOptions<Data, Error, Input>,
) {
  const client = useQueryClient();
  const mutation = useMutation({
    ...options,
    onError: async (error, variables, result, context) => {
      if (error instanceof AppRequestError && error.code === "stale")
        await client.invalidateQueries();
      await options.onError?.(error, variables, result, context);
    },
  });
  const uncertain = outcomeUnknown(mutation.error);
  const retry = () => {
    if (mutation.variables) mutation.mutate(mutation.variables);
  };
  const submit = (input: Input) => {
    if (uncertain) retry();
    else mutation.mutate(input);
  };
  return { mutation, submit, retry, uncertain };
}
