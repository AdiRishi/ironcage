import type {
  CounterpartyId,
  ListCounterparties,
  ListCounterpartyHistory,
  RecordCursor,
  SearchDescriptors,
} from "@repo/contracts/finance";
import { infiniteQueryOptions, keepPreviousData, queryOptions } from "@tanstack/react-query";

import {
  getCounterparty,
  listCounterparties,
  listCounterpartyHistory,
  searchDescriptors,
} from "./functions";

export const counterpartiesQuery = (input: typeof ListCounterparties.Type) =>
  queryOptions({
    queryKey: ["listCounterparties", input],
    queryFn: () => listCounterparties({ data: input }),
  });
export const counterpartyQuery = (counterpartyId: typeof CounterpartyId.Type) =>
  queryOptions({
    queryKey: ["getCounterparty", { counterpartyId }],
    queryFn: () => getCounterparty({ data: { counterpartyId } }),
  });
// Keeps the last matches on screen while the next search runs.
export const descriptorSearchQuery = (input: typeof SearchDescriptors.Type) =>
  queryOptions({
    queryKey: ["searchDescriptors", input],
    queryFn: () => searchDescriptors({ data: input }),
    placeholderData: keepPreviousData,
  });
// A counterparty's changes, newest first, one page after another.
export const counterpartyHistoryQuery = (
  input: Omit<typeof ListCounterpartyHistory.Type, "cursor">,
) =>
  infiniteQueryOptions({
    queryKey: ["listCounterpartyHistory", input, "pages"],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof RecordCursor.Type | null }) =>
      listCounterpartyHistory({ data: pageParam ? { ...input, cursor: pageParam } : input }),
    getNextPageParam: (page) => page.nextCursor,
  });
