import { createFileRoute } from "@tanstack/react-router";

import { RecurringCharges } from "@/features/money/components/recurring-charges";

export const Route = createFileRoute("/money/recurring")({ component: MoneyRecurring });

function MoneyRecurring() {
  return <RecurringCharges />;
}
