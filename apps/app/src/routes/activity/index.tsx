import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/activity/")({ component: ActivityFeed });

function ActivityFeed() {
  return (
    <PagePlaceholder
      title="Activity"
      description="The append-only record of everything that happened, filterable by origin, category, severity, time, and text."
      doc="docs/product/03-activity.md"
    />
  );
}
