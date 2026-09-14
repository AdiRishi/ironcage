import { queryOptions } from "@tanstack/react-query";

import { listImports } from "./functions";
export const importsQueryOptions = () =>
  queryOptions({
    queryKey: ["imports"],
    queryFn: () => listImports(),
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "processing") ? 1500 : false,
  });
