import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/activity/trade/$correlationId")({ component: TradeStory });

function TradeStory() {
  return (
    <PagePlaceholder
      title="Trade story"
      description="One trade told as a narrative: the signal that opened it, every verdict and fill along the way, and how it closed."
      doc="docs/product/03-activity.md"
    />
  );
}
