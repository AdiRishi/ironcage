import { queryOptions } from "@tanstack/react-query";

import { listReviewItems } from "./functions";
export const reviewQueryOptions = () =>
  queryOptions({ queryKey: ["reviews"], queryFn: () => listReviewItems() });
