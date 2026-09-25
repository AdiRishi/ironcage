import type { EventId, PostingId } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getEventForPosting, getEventHistory, getReferenceData } from "./functions";

export const eventForPostingQuery = (postingId: typeof PostingId.Type) =>
  queryOptions({
    queryKey: ["event", { postingId }],
    queryFn: () => getEventForPosting({ data: { postingId } }),
  });
export const referenceDataQuery = () =>
  queryOptions({ queryKey: ["referenceData"], queryFn: () => getReferenceData() });
export const eventHistoryQuery = (eventId: typeof EventId.Type) =>
  queryOptions({
    queryKey: ["getEventHistory", { eventId }],
    queryFn: () => getEventHistory({ data: { eventId } }),
  });
