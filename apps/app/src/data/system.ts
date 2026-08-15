import { SystemStatus } from "@ironcage/contracts/schema";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import { keys } from "@/data/keys";
import { visibleSafetyPoll } from "@/data/polling";
import { getSystemStatus } from "@/server/system";

export const systemStatusQuery = queryOptions({
  queryKey: keys.system(),
  queryFn: () => getSystemStatus(),
  select: Schema.decodeSync(SystemStatus),
  staleTime: 10_000,
  refetchInterval: visibleSafetyPoll,
});
