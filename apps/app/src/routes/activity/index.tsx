import { Skeleton } from "@ironcage/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { ActivityFeedView } from "@/features/activity/components/activity-feed";
import { feedQuery } from "@/features/activity/queries";

export const Route = createFileRoute("/activity/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(feedQuery),
  component: ActivityFeed,
});

function ActivityFeed() {
  const feed = useQuery(feedQuery);
  if (feed.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (feed.isError)
    return <p className="text-sm text-destructive">Activity unavailable — {String(feed.error)}</p>;
  return <ActivityFeedView events={feed.data.events} />;
}
