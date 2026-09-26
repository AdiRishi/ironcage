import { queryOptions } from "@tanstack/react-query";

import { getModelSettings, getModelUsage } from "./functions";

export const modelSettingsQuery = () =>
  queryOptions({ queryKey: ["getModelSettings"], queryFn: () => getModelSettings() });
export const modelUsageQuery = () =>
  queryOptions({ queryKey: ["getModelUsage"], queryFn: () => getModelUsage() });
