import { type ImportId, type ListReviewItems, type RecordCursor } from "@repo/contracts/finance";
import { infiniteQueryOptions } from "@tanstack/react-query";

import { listReviewItems } from "./functions";

const reviewsQuery = (input: Omit<typeof ListReviewItems.Type, "cursor">) =>
  infiniteQueryOptions({
    queryKey: ["reviews", input],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof RecordCursor.Type | null }) =>
      listReviewItems({ data: pageParam ? { ...input, cursor: pageParam } : input }),
    getNextPageParam: (page) => page.nextCursor,
  });

// The rows still to check, of one file or of every file.
export const openReviewsQuery = (importId: typeof ImportId.Type | undefined) =>
  reviewsQuery(importId ? { importId, open: true } : { open: true });
