import { CounterpartyId } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { CounterpartyPage } from "@/features/counterparties/detail";
import { counterpartyQuery } from "@/features/counterparties/queries";
import { referenceDataQuery } from "@/features/events/queries";
import { ledgerQuery } from "@/features/ledger/queries";

const recentInput = (counterpartyId: typeof CounterpartyId.Type) => ({
  filter: { counterpartyId },
});

export const Route = createFileRoute("/counterparties/$counterpartyId")({
  params: {
    parse: ({ counterpartyId }) => ({ counterpartyId: CounterpartyId.make(counterpartyId) }),
  },
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(counterpartyQuery(params.counterpartyId)),
      context.queryClient.ensureQueryData(referenceDataQuery()),
      context.queryClient.ensureQueryData(ledgerQuery(recentInput(params.counterpartyId))),
    ]),
  component: Counterparty,
});

function Counterparty() {
  const { counterpartyId } = Route.useParams();
  const { data: detail } = useSuspenseQuery(counterpartyQuery(counterpartyId));
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  const { data: recent } = useSuspenseQuery(ledgerQuery(recentInput(counterpartyId)));
  return (
    <CounterpartyPage
      key={`${detail.counterparty.id}:${detail.counterparty.version}`}
      detail={detail}
      references={references}
      recent={recent}
    />
  );
}
