import { type ListReviewItems, type RecordCursor } from "@repo/contracts/finance";
import { infiniteQueryOptions } from "@tanstack/react-query";

import { listReviewItems } from "./functions";
export const reviewQueryOptions = (input: typeof ListReviewItems.Type = {}) =>
  infiniteQueryOptions({
    queryKey: ["reviews", input],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof RecordCursor.Type | null }) =>
      listReviewItems({ data: pageParam ? { ...input, cursor: pageParam } : input }),
    getNextPageParam: (page) => {
      const last = page.at(-1);
      return page.length === 100 && last ? { createdAt: last.createdAt, id: last.id } : null;
    },
  });
