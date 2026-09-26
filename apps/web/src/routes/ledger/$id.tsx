import { PostingId } from "@repo/contracts/finance";
import { createFileRoute } from "@tanstack/react-router";

import { LedgerDetail } from "@/features/ledger/detail";
import { postingQueryOptions } from "@/features/ledger/queries";
import { addressNotFound, pathParam } from "@/lib/address";

export const Route = createFileRoute("/ledger/$id")({
  params: { parse: ({ id }) => ({ id: pathParam(PostingId, id) }) },
  onError: addressNotFound,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(postingQueryOptions({ postingId: params.id })),
  component: LedgerDetailRoute,
});

function LedgerDetailRoute() {
  const { id } = Route.useParams();
  return <LedgerDetail id={id} />;
}
