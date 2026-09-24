import { CalendarDate, type FlowInput } from "@repo/contracts/finance";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { exportsQueryOptions } from "@/features/exports/queries";
import { monthlyFlowQuery, periodFlowQuery } from "@/features/flow/queries";
import { importsQueryOptions } from "@/features/imports/queries";
import { useImportCompletion } from "@/features/imports/use-import-completion";
import { settingsQueryOptions } from "@/features/settings/queries";
import { SourcesPage } from "@/features/sources/page";
import { sourceFilesQueryOptions } from "@/features/sources/queries";
import { periodRange, resolvePeriodKey } from "@/lib/period";

// The whole history, from the first month with records to the end of this month.
function historyInput(firstMonth: string | undefined, currency: string): FlowInput {
  const { start, endExclusive } = periodRange(resolvePeriodKey(undefined));
  return {
    period: {
      kind: "fixed",
      start: firstMonth ? CalendarDate.make(`${firstMonth}-01`) : start,
      endExclusive,
    },
    comparison: { kind: "previous" },
    basis: "spending",
    currency,
  };
}

export const Route = createFileRoute("/sources/")({
  loader: async ({ context }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const months = await context.queryClient.ensureQueryData(
      monthlyFlowQuery(settings.reportingCurrency),
    );
    await Promise.all([
      context.queryClient.ensureQueryData(
        periodFlowQuery(historyInput(months[0]?.month, settings.reportingCurrency)),
      ),
      context.queryClient.ensureInfiniteQueryData(importsQueryOptions()),
      context.queryClient.ensureQueryData(sourceFilesQueryOptions()),
      context.queryClient.ensureQueryData(exportsQueryOptions()),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
    ]);
  },
  component: Sources,
});

function Sources() {
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const { data: months } = useSuspenseQuery(monthlyFlowQuery(settings.reportingCurrency));
  const { data: flow } = useSuspenseQuery(
    periodFlowQuery(historyInput(months[0]?.month, settings.reportingCurrency)),
  );
  const history = useSuspenseInfiniteQuery(importsQueryOptions());
  const imports = history.data.pages.flatMap((page) => page.rows);
  useImportCompletion(imports);
  return <SourcesPage coverage={flow.coverage} imports={imports} timezone={settings.timezone} />;
}
