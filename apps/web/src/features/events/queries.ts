import type { PostingId } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getEventForPosting, getReferenceData } from "./functions";
export const eventForPostingQuery = (postingId: typeof PostingId.Type) =>
  queryOptions({
    queryKey: ["event", { postingId }],
    queryFn: () => getEventForPosting({ data: { postingId } }),
  });
export const referenceDataQuery = () =>
  queryOptions({ queryKey: ["referenceData"], queryFn: () => getReferenceData() });
