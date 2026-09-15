import { queryOptions } from "@tanstack/react-query";

import { listExports } from "./functions";

export const exportsQueryOptions = () =>
  queryOptions({
    queryKey: ["exports"],
    queryFn: () => listExports(),
    refetchInterval: (query) =>
      query.state.data?.some((item) => item.status === "processing") ? 1500 : false,
  });
