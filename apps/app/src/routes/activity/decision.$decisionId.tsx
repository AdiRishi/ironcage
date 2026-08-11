import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/activity/decision/$decisionId")({
  component: DecisionRecord,
});

function DecisionRecord() {
  return (
    <PagePlaceholder
      title="Decision record"
      description="One AI output opened to its permanent record: inputs, prompt, model, cost, and what the system did with it."
      doc="docs/product/03-activity.md"
    />
  );
}
