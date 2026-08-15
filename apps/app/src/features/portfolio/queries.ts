import { ExternalAccount, WholeWealth } from "@ironcage/contracts/schema";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import { keys } from "@/data/keys";
import { visibleSafetyPoll } from "@/data/polling";
import { getWholeWealth, listExternalAccounts } from "@/server/portfolio";

export const wealthQuery = queryOptions({
  queryKey: keys.wealth(),
  queryFn: () => getWholeWealth(),
  select: Schema.decodeSync(WholeWealth),
  refetchInterval: visibleSafetyPoll,
});

export const externalAccountsQuery = queryOptions({
  queryKey: keys.externalAccounts(),
  queryFn: () => listExternalAccounts(),
  select: Schema.decodeSync(Schema.Array(ExternalAccount)),
});
