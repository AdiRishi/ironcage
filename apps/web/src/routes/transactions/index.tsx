import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { TransactionsPage } from "@/features/transactions/page";
import { TransactionSearch, transactionQuery } from "@/features/transactions/search";

export const Route = createFileRoute("/transactions/")({
  validateSearch: Schema.toStandardSchemaV1(TransactionSearch),
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(transactionQuery(deps)),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]),
  component: Page,
});
function Page() {
  const navigate = Route.useNavigate();
  return (
    <TransactionsPage search={Route.useSearch()} navigate={(search) => navigate({ search })} />
  );
}
