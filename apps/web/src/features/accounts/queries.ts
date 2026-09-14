import { queryOptions } from "@tanstack/react-query";

import { listAccounts } from "./functions";

export const accountsQueryOptions = () =>
  queryOptions({ queryKey: ["accounts"], queryFn: () => listAccounts() });
