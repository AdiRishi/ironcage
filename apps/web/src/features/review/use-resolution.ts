import { CommandId, ResolveReview, type ReviewItem } from "@repo/contracts/finance";
import { useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

import { useCommand } from "@/lib/use-command";

import { resolveReview } from "./functions";

export function useResolution(review: ReviewItem) {
  const client = useQueryClient();
  const { mutation, submit, retry, uncertain } = useCommand({
    mutationFn: async (data: typeof ResolveReview.Type) =>
      resolveReview({ data: await Effect.runPromise(Schema.encodeEffect(ResolveReview)(data)) }),
    onSuccess: () => client.invalidateQueries(),
  });
  return {
    mutation,
    retry,
    uncertain,
    refresh: async () => {
      await client.invalidateQueries({ queryKey: ["reviews"] });
      mutation.reset();
    },
    submit: (resolution: (typeof ResolveReview.Type)["resolution"]) =>
      submit({
        commandId: CommandId.make(crypto.randomUUID()),
        reviewItemId: review.id,
        expectedVersion: review.version,
        resolution,
      }),
  };
}
