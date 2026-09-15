import { type ImportId, type RecordCursor } from "@repo/contracts/finance";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import { getImport, listImports } from "./functions";

export const importQueryOptions = (importId: typeof ImportId.Type) =>
  queryOptions({
    queryKey: ["imports", importId],
    queryFn: () => getImport({ data: { importId } }),
    refetchInterval: (query) => (query.state.data?.status === "processing" ? 1500 : false),
  });
export const importsQueryOptions = () =>
  infiniteQueryOptions({
    queryKey: ["imports"],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof RecordCursor.Type | null }) =>
      listImports({ data: pageParam ? { cursor: pageParam } : {} }),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.rows.some((item) => item.status === "processing"))
        ? 1500
        : false,
  });
