import { createFileRoute } from "@tanstack/react-router";

import { PagePlaceholder } from "@/components/common/page-placeholder";

export const Route = createFileRoute("/workbench/backtests/$runId")({ component: BacktestRun });

function BacktestRun() {
  return (
    <PagePlaceholder
      title="Backtest run"
      description="One run: its manifest, its results, and its artifacts."
      doc="docs/product/08-workbench.md"
    />
  );
}
