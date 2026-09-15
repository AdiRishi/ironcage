import { AppRequestError } from "@repo/contracts/app";
import { CommandId } from "@repo/contracts/finance";
import { useMutation, type UseMutationOptions } from "@tanstack/react-query";

export function useCommand<Input extends { commandId: typeof CommandId.Type }, Data>(
  options: UseMutationOptions<Data, Error, Input>,
) {
  const mutation = useMutation({ ...options, retry: false });
  const uncertain =
    mutation.error instanceof AppRequestError && mutation.error.code === "unavailable";

  function submit(input: Input) {
    mutation.mutate(uncertain && mutation.variables ? mutation.variables : input);
  }

  return { mutation, submit, uncertain };
}
