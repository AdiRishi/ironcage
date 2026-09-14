import { type RecordCursor } from "@repo/contracts/finance";
import { infiniteQueryOptions } from "@tanstack/react-query";

import { listImports } from "./functions";
export const importsQueryOptions = () =>
  infiniteQueryOptions({
    queryKey: ["imports"],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof RecordCursor.Type | null }) =>
      listImports({ data: pageParam ? { cursor: pageParam } : {} }),
    getNextPageParam: (page) => {
      const last = page.at(-1);
      return page.length === 100 && last ? { createdAt: last.createdAt, id: last.id } : null;
    },
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.some((item) => item.status === "processing"))
        ? 1500
        : false,
  });
