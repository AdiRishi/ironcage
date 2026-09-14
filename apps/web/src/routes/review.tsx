import { ListReviewItems } from "@repo/contracts/finance";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { ReviewPage } from "@/features/review/page";
import { reviewQueryOptions } from "@/features/review/queries";

export const Route = createFileRoute("/review")({
  validateSearch: Schema.toStandardSchemaV1(ListReviewItems),
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    await Promise.all([
      context.queryClient.ensureInfiniteQueryData(reviewQueryOptions(deps)),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]);
  },
  component: Page,
});
function Page() {
  return <ReviewPage filter={Route.useSearch()} />;
}
