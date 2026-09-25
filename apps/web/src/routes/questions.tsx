import { ImportId, QuestionFilter } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { CategoryProposalsSection } from "@/features/enrichment/proposals";
import { categoryProposalsQuery } from "@/features/enrichment/queries";
import { referenceDataQuery } from "@/features/events/queries";
import { QuestionsPage } from "@/features/questions/page";
import { questionSummaryQuery, questionsQuery } from "@/features/questions/queries";
import { interpretationReviewsQuery } from "@/features/relationships/queries";
import { RelationshipProposals } from "@/features/relationships/reviews";
import { SourceReviews } from "@/features/review/page";
import { reviewQueryOptions } from "@/features/review/queries";
import { settingsQueryOptions } from "@/features/settings/queries";
import { periodSelection, resolvePeriodKey } from "@/lib/period";

const Search = Schema.Struct({
  kind: Schema.optional(QuestionFilter),
  importId: Schema.optional(ImportId),
  // Only the questions with a transaction in the selected period, as the overview counts
  // them. Without it, the screen covers the whole history, as the top bar does.
  scope: Schema.optional(Schema.Literal("period")),
});

export const Route = createFileRoute("/questions")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => ({
    kind: search.kind,
    importId: search.importId,
    scope: search.scope,
    period: search.period,
  }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    const period = deps.scope ? resolvePeriodKey(deps.period, settings.timezone) : null;
    const selection = period && periodSelection(period);
    await Promise.all([
      context.queryClient.ensureQueryData(
        questionSummaryQuery({ currency: settings.reportingCurrency, period: selection }),
      ),
      context.queryClient.ensureInfiniteQueryData(
        questionsQuery({
          currency: settings.reportingCurrency,
          filter: deps.kind ?? null,
          period: selection,
        }),
      ),
      context.queryClient.ensureQueryData(referenceDataQuery()),
      context.queryClient.ensureQueryData(categoryProposalsQuery()),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
      context.queryClient.ensureInfiniteQueryData(
        reviewQueryOptions(
          deps.importId ? { importId: deps.importId, open: true } : { open: true },
        ),
      ),
      context.queryClient.ensureInfiniteQueryData(interpretationReviewsQuery()),
    ]);
  },
  component: Questions,
});

function Questions() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const period = search.scope ? resolvePeriodKey(search.period, settings.timezone) : null;
  const selection = period && periodSelection(period);
  const { data: summary } = useSuspenseQuery(
    questionSummaryQuery({ currency: settings.reportingCurrency, period: selection }),
  );
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  const { data: proposals } = useSuspenseQuery(categoryProposalsQuery());
  return (
    <QuestionsPage
      input={{
        currency: settings.reportingCurrency,
        filter: search.kind ?? null,
        period: selection,
      }}
      summary={summary}
      periodLabel={period?.label ?? null}
      references={references}
      onFilter={(kind) => {
        navigate({ search: (previous) => ({ ...previous, kind: kind ?? undefined }) }).catch(
          reportError,
        );
      }}
    >
      <CategoryProposalsSection proposals={proposals} />
      <SourceReviews importId={search.importId} />
      <RelationshipProposals />
    </QuestionsPage>
  );
}
