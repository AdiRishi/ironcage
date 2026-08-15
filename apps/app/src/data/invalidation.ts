import type { FeedEventView } from "@ironcage/contracts/schema";
import type { QueryKey } from "@tanstack/react-query";

import { keys } from "@/data/keys";

export const invalidationsFor = (event: FeedEventView): readonly QueryKey[] => {
  const result: QueryKey[] = [keys.feed(), keys.system()];
  if (event.category === "money_tax") result.push(keys.moneyAll(), keys.wealth());
  if (event.eventType === "report_generated") result.push(keys.reports());
  if (event.eventType === "external_balance_recorded") result.push(keys.externalAccounts());
  return result;
};
