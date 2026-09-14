import { CommandId, ResolveReview, type ReviewItem } from "@repo/contracts/finance";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

import { resolveReview } from "./functions";

export function useResolution(review: ReviewItem) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (data: typeof ResolveReview.Type) =>
      resolveReview({ data: await Effect.runPromise(Schema.encodeEffect(ResolveReview)(data)) }),
    onSuccess: () =>
      client.invalidateQueries({
        predicate: (query) =>
          ["reviews", "imports", "postings", "posting", "accounts"].includes(
            String(query.queryKey[0]),
          ),
      }),
  });
  return {
    mutation,
    submit: (resolution: (typeof ResolveReview.Type)["resolution"]) =>
      mutation.mutate({
        commandId: CommandId.make(crypto.randomUUID()),
        reviewItemId: review.id,
        expectedVersion: review.version,
        resolution,
      }),
  };
}
