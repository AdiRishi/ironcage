import { ImportId } from "@repo/contracts/finance";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { accountsQueryOptions } from "@/features/accounts/queries";
import { referenceDataQuery } from "@/features/events/queries";
import { QuestionsPage } from "@/features/questions/page";
import { questionsQuery } from "@/features/questions/queries";
import { MovementProposals } from "@/features/relationships/reviews";
import { SourceReviews } from "@/features/review/page";
import { reviewQueryOptions } from "@/features/review/queries";
import { settingsQueryOptions } from "@/features/settings/queries";

const Search = Schema.Struct({
  kind: Schema.optional(Schema.Literals(["who", "people", "accounts", "rules"])),
  importId: Schema.optional(ImportId),
});

export const Route = createFileRoute("/questions")({
  validateSearch: Schema.toStandardSchemaV1(Search),
  loaderDeps: ({ search }) => ({ importId: search.importId }),
  loader: async ({ context, deps }) => {
    const settings = await context.queryClient.ensureQueryData(settingsQueryOptions());
    await Promise.all([
      context.queryClient.ensureQueryData(questionsQuery(settings.reportingCurrency)),
      context.queryClient.ensureQueryData(referenceDataQuery()),
      context.queryClient.ensureQueryData(accountsQueryOptions()),
      context.queryClient.ensureInfiniteQueryData(
        reviewQueryOptions(
          deps.importId ? { importId: deps.importId, open: true } : { open: true },
        ),
      ),
    ]);
  },
  component: Questions,
});

function Questions() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const { data: questions } = useSuspenseQuery(questionsQuery(settings.reportingCurrency));
  const { data: references } = useSuspenseQuery(referenceDataQuery());
  return (
    <QuestionsPage
      questions={questions}
      references={references}
      filter={search.kind ?? null}
      onFilter={(kind) => {
        navigate({ search: (previous) => ({ ...previous, kind: kind ?? undefined }) }).catch(
          reportError,
        );
      }}
    >
      <SourceReviews importId={search.importId} />
      <MovementProposals />
    </QuestionsPage>
  );
}
