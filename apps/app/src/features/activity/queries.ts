import { FeedPage } from "@ironcage/contracts/schema";
import { queryOptions } from "@tanstack/react-query";
import { Schema } from "effect";

import { keys } from "@/data/keys";
import { getFeed } from "@/server/feed";

export const feedQuery = queryOptions({
  queryKey: keys.feed(),
  queryFn: () => getFeed({ data: { cursor: null, categories: [], severities: [], limit: 100 } }),
  select: Schema.decodeSync(FeedPage),
});
