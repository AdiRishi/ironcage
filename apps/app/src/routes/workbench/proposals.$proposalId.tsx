import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/workbench/proposals/$proposalId")({
  component: ProposalDetail,
});

function ProposalDetail() {
  return (
    <PagePlaceholder
      title="Proposal"
      description="One proposal and the verdict from each gate it has faced."
      doc="docs/product/08-workbench.md"
    />
  );
}
