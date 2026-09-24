import { CategoryId } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { referenceDataQuery } from "@/features/events/queries";
import { spendingQuery } from "@/features/flow/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { SpendingPage } from "@/features/spending/page";
import { flowInput, resolvePeriodKey } from "@/lib/period";

const Search = Schema.Struct({ category: Schema.optional(CategoryId) });

export const Route = createFileRoute("/spending")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => ({ period: search.period, category: search.category }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    await Promise.all([
      context.queryClient.ensureQueryData(
        spendingQuery({
          ...flowInput(resolvePeriodKey(deps.period), settings.reportingCurrency),
          categoryId: deps.category ?? null,
        }),
      ),
      context.queryClient.ensureQueryData(referenceDataQuery()),
    ]);
  },
  component: Spending,
});

function Spending() {
  const search = Route.useSearch();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = resolvePeriodKey(search.period);
  const { data: breakdown } = useSuspenseQuery(
    spendingQuery({
      ...flowInput(period, settings.reportingCurrency),
      categoryId: search.category ?? null,
    }),
  );
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  const parents = new Set<string>(
    references.categories.flatMap((category) => (category.parentId ? [category.parentId] : [])),
  );
  return <SpendingPage breakdown={breakdown} period={period} parents={parents} />;
}
