import { formatMoney } from "@repo/finance";
import { useSuspenseQuery } from "@tanstack/react-query";

import { modelUsageQueryOptions } from "./queries";

export function ModelUsageSection() {
  const { data } = useSuspenseQuery(modelUsageQueryOptions());
  return (
    <section className="space-y-3 rounded-lg border p-5 sm:p-6">
      <h2 className="text-xl font-semibold">Document model</h2>
      <p className="font-medium">
        {data.enabled ? "Enabled" : "Disabled"} · {data.provider ?? "No provider configured"}
      </p>
      <p className="text-sm text-muted-foreground">
        Statements use deterministic parsing. No pages are sent to a model provider. An unreadable
        page goes to Review.
      </p>
      <p className="text-sm">
        {data.calls.toLocaleString()} calls · {data.inputTokens.toLocaleString()} input tokens ·{" "}
        {data.outputTokens.toLocaleString()} output tokens
      </p>
      <p className="text-sm text-muted-foreground">
        Usage warning threshold: {data.warning ? formatMoney(data.warning) : "not set"}
      </p>
      {data.costs.map((cost) => (
        <p key={cost.currency} className="text-sm">
          Recorded cost: {formatMoney(cost)}
        </p>
      ))}
      {data.unknownUsage > 0 && (
        <p className="text-sm text-muted-foreground">
          {data.unknownUsage} calls have incomplete usage reports.
        </p>
      )}
    </section>
  );
}
