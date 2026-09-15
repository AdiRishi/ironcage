import { PostingId } from "@repo/contracts/finance";
import { createFileRoute } from "@tanstack/react-router";

import { TransactionDetail } from "@/features/transactions/detail";
import { postingQueryOptions } from "@/features/transactions/queries";

export const Route = createFileRoute("/transactions/$id")({
  params: { parse: ({ id }) => ({ id: PostingId.make(id) }) },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postingQueryOptions({ postingId: params.id })),
  component: TransactionDetailRoute,
});

function TransactionDetailRoute() {
  const { id } = Route.useParams();
  return <TransactionDetail id={id} />;
}
