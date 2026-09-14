import { ImportId } from "@repo/contracts/finance";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { ReviewPage } from "@/features/review/page";
import { reviewQueryOptions } from "@/features/review/queries";

export const Route = createFileRoute("/review")({
  validateSearch: Schema.toStandardSchemaV1(
    Schema.Struct({ importId: Schema.optionalKey(ImportId) }),
  ),
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(reviewQueryOptions()),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]);
  },
  component: Page,
});
function Page() {
  return <ReviewPage importId={Route.useSearch().importId} />;
}
