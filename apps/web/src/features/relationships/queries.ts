import type { InterpretationReviewCursor } from "@repo/contracts/finance";
import { infiniteQueryOptions } from "@tanstack/react-query";

import { listInterpretationReviews } from "./functions";

// Refunds to link and movements to confirm, one page after another.
export const interpretationReviewsQuery = () =>
  infiniteQueryOptions({
    queryKey: ["listInterpretationReviews", {}, "pages"],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof InterpretationReviewCursor.Type | null }) =>
      listInterpretationReviews({ data: pageParam ? { cursor: pageParam } : {} }),
    getNextPageParam: (page) => page.nextCursor,
  });
