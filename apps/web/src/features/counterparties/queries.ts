import type { CounterpartyId, ListCounterparties } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getCounterparty, listCounterparties } from "./functions";

export const counterpartiesQuery = (input: typeof ListCounterparties.Type) =>
  queryOptions({
    queryKey: ["counterparties", input],
    queryFn: () => listCounterparties({ data: input }),
  });
export const counterpartyQuery = (counterpartyId: typeof CounterpartyId.Type) =>
  queryOptions({
    queryKey: ["counterparty", counterpartyId],
    queryFn: () => getCounterparty({ data: { counterpartyId } }),
  });
