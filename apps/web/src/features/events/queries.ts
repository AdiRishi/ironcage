import type { PostingId } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { getEventForPosting, getInterpretationSummary, getReferenceData } from "./functions";
export const eventForPostingQuery = (postingId: typeof PostingId.Type) =>
  queryOptions({
    queryKey: ["event", { postingId }],
    queryFn: () => getEventForPosting({ data: { postingId } }),
  });
export const interpretationSummaryQuery = () =>
  queryOptions({ queryKey: ["interpretationSummary"], queryFn: () => getInterpretationSummary() });
export const referenceDataQuery = () =>
  queryOptions({ queryKey: ["referenceData"], queryFn: () => getReferenceData() });
