import type { Account, AccountCoverage, CalendarDate, Period } from "@repo/contracts/finance";

import { addDays, missingPeriods, mergePeriods } from "./periods.ts";

export function accountCoverage(
  snapshot: {
    accounts: readonly Account[];
    sources: readonly {
      accountId: Account["id"];
      observedStart: CalendarDate | null;
      observedEnd: CalendarDate | null;
      openingOn: CalendarDate | null;
      closingOn: CalendarDate | null;
      reconciled: boolean;
    }[];
    imports: readonly { accountId: Account["id"]; at: string }[];
  },
  period: Period,
): AccountCoverage[] {
  return snapshot.accounts.map((account) => {
    const sources = snapshot.sources.filter((source) => source.accountId === account.id);
    const observed = sources.flatMap((source) =>
      source.observedStart && source.observedEnd
        ? [{ start: source.observedStart, endExclusive: addDays(source.observedEnd, 1) }]
        : [],
    );
    const reconciled = sources.flatMap((source) =>
      source.reconciled && source.openingOn && source.closingOn
        ? [{ start: source.openingOn, endExclusive: addDays(source.closingOn, 1) }]
        : [],
    );
    return {
      account: {
        id: account.id,
        kind: account.kind,
        label: account.label,
        currency: account.currency,
      },
      observed: mergePeriods(observed),
      reconciled: mergePeriods(reconciled),
      missing: missingPeriods(period, reconciled),
      latestImportAt: snapshot.imports.find((item) => item.accountId === account.id)?.at ?? null,
    };
  });
}
