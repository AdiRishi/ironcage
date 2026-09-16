import type { OverviewResult } from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
export function Coverage({ coverage }: { coverage: OverviewResult["coverage"] }) {
  return (
    <section className="rounded-lg border p-5">
      <h2 className="text-lg font-semibold">Account coverage</h2>
      {coverage.accounts.length === 0 && (
        <p>No accounts in this currency. Add an account in Settings.</p>
      )}
      <ul className="divide-y">
        {coverage.accounts.map(({ account, missing, observed, latestImportAt }) => (
          <li key={account.id} className="py-3">
            <p className="font-medium">{account.label}</p>
            <p className="text-sm">
              {missing.length === 0
                ? "Complete, reconciled coverage"
                : missing
                    .map(
                      (period) => `Missing ${period.start} to ${period.endExclusive}, end excluded`,
                    )
                    .join("; ")}
            </p>
            <p className="text-xs text-muted-foreground">
              Observed{" "}
              {observed.length
                ? observed
                    .map((period) => `${period.start} to ${period.endExclusive}, end excluded`)
                    .join("; ")
                : "no dates"}
              . Latest import {latestImportAt ?? "none"}.
            </p>
          </li>
        ))}
      </ul>
      {coverage.unresolvedCount > 0 && (
        <p className="mt-3 text-sm text-destructive">
          {coverage.unresolvedCount} unresolved financial events,{" "}
          {formatMoney(coverage.unresolvedAmount)}, may change these totals.
        </p>
      )}
      {coverage.unlinkedCredits.minor > 0n && (
        <p className="mt-3 text-sm">
          Unlinked credits: {formatMoney(coverage.unlinkedCredits)}. These have not reduced costs.
        </p>
      )}
    </section>
  );
}
