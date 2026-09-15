import { queryOptions } from "@tanstack/react-query";

import { getSettings, getRetention, getModelUsage } from "./functions";

export const settingsQueryOptions = () =>
  queryOptions({ queryKey: ["settings"], queryFn: () => getSettings() });

export const retentionQueryOptions = () =>
  queryOptions({ queryKey: ["retention"], queryFn: () => getRetention() });

export const modelUsageQueryOptions = () =>
  queryOptions({ queryKey: ["modelUsage"], queryFn: () => getModelUsage() });
