import { type ListReviewItems, type RecordCursor } from "@repo/contracts/finance";
import { infiniteQueryOptions } from "@tanstack/react-query";

import { listReviewItems } from "./functions";

export const reviewQueryOptions = (input: Omit<typeof ListReviewItems.Type, "cursor"> = {}) =>
  infiniteQueryOptions({
    queryKey: ["reviews", input],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof RecordCursor.Type | null }) =>
      listReviewItems({ data: pageParam ? { ...input, cursor: pageParam } : input }),
    getNextPageParam: (page) => page.nextCursor,
  });
