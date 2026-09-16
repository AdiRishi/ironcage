import type { OverviewInput } from "@repo/contracts/finance";
import { queryOptions } from "@tanstack/react-query";

import { overview } from "./functions";
export const overviewQuery = (input: OverviewInput) =>
  queryOptions({
    queryKey: ["analysis", "overview", input],
    queryFn: () => overview({ data: input }),
    staleTime: 0,
  });
