import { createFileRoute } from "@tanstack/react-router";

import { MonthlySpending } from "@/features/money/components/monthly-spending";

export const Route = createFileRoute("/money/")({ component: MoneySpending });

function MoneySpending() {
  return <MonthlySpending />;
}
