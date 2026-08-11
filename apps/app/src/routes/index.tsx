import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";
import { CoreBindingProbe } from "@/features/overview/components/core-binding-probe";

export const Route = createFileRoute("/")({ component: Overview });

function Overview() {
  return (
    <>
      <CoreBindingProbe />
      <PagePlaceholder
        title="Overview"
        description="System vitals, the items waiting on you, total equity, and a summary of every sleeve — the five-second answer to whether everything is okay."
        doc="docs/product/01-overview.md"
      />
    </>
  );
}
