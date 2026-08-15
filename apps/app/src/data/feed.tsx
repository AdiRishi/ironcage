import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";

import { connectFeed, type FeedConnection } from "@/data/feed-client";
import { invalidationsFor } from "@/data/invalidation";

const FeedConnectionContext = createContext<FeedConnection>("connecting");

export function FeedProvider({ children }: { readonly children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<FeedConnection>("connecting");

  useEffect(
    () =>
      connectFeed({
        onConnection: setConnection,
        onEvent: (event) => {
          for (const queryKey of invalidationsFor(event)) {
            queryClient.invalidateQueries({ queryKey }).catch(() => undefined);
          }
        },
        onLagged: () => {
          queryClient.invalidateQueries({ type: "active" }).catch(() => undefined);
        },
      }),
    [queryClient],
  );

  return (
    <FeedConnectionContext.Provider value={connection}>{children}</FeedConnectionContext.Provider>
  );
}

export const useFeedConnection = () => useContext(FeedConnectionContext);
