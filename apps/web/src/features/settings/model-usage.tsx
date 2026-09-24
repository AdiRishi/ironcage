import { formatMoney } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";

import { modelUsageQueryOptions } from "./queries";

export function ModelUsageSection() {
  const { data } = useSuspenseQuery(modelUsageQueryOptions());
  return (
    <section className="space-y-3">
      <h2 className="type-heading">Model usage</h2>
      <p className="type-small text-slate">
        Only counterparty identification calls a model. Statements are parsed without one, and an
        unreadable page becomes a question.
      </p>
      <p className="text-sm">
        {data.calls.toLocaleString()} calls · {data.inputTokens.toLocaleString()} input tokens ·{" "}
        {data.outputTokens.toLocaleString()} output tokens
      </p>
      {data.costs.map((cost) => (
        <p key={cost.currency} className="text-sm">
          Recorded cost: {formatMoney(cost)}
        </p>
      ))}
      {data.unknownUsage > 0 && (
        <p className="type-small text-slate">
          {data.unknownUsage} calls have incomplete usage reports.
        </p>
      )}
    </section>
  );
}
