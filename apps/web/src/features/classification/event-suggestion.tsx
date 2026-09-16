import {
  CommandId,
  type AcceptSuggestions,
  type EventId,
  type SuggestCategories,
} from "@repo/contracts/finance";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";

import { referenceDataQuery } from "../events/queries";
import {
  acceptSuggestions,
  getCategorySuggestion,
  getClassificationSettings,
  suggestCategories,
} from "./functions";
import { useClassificationRuns } from "./queries";

export function EventSuggestion({ eventId }: { eventId: typeof EventId.Type }) {
  const query = useQuery({
    queryKey: ["suggestion", eventId],
    queryFn: () => getCategorySuggestion({ data: { eventId } }),
  });
  const settings = useQuery({
    queryKey: ["classificationSettings"],
    queryFn: () => getClassificationSettings(),
  });
  const references = useQuery(referenceDataQuery());
  const runs = useClassificationRuns();
  const client = useQueryClient();
  const acceptance = useCommand({
    mutationFn: (data: typeof AcceptSuggestions.Type) => acceptSuggestions({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const request = useCommand({
    mutationFn: (data: typeof SuggestCategories.Type) => suggestCategories({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const run = runs.data?.find((row) => row.id === request.mutation.data?.id);
  const suggestion = query.data;
  return (
    <section className="space-y-3 border-t pt-4">
      <h3 className="font-medium">Category suggestion</h3>
      {suggestion ? (
        <>
          <p>
            {suggestion.categoryId
              ? (references.data?.categories.find(
                  (category) => category.id === suggestion.categoryId,
                )?.name ?? "Category unavailable")
              : "Needs review"}
          </p>
          <p className="text-sm text-muted-foreground">{suggestion.reason}</p>
          {suggestion.categoryId && (
            <Button
              variant="outline"
              disabled={acceptance.mutation.isPending}
              onClick={() =>
                acceptance.submit({
                  commandId: CommandId.make(crypto.randomUUID()),
                  expectedVersions: [{ eventId, version: suggestion.eventVersion }],
                })
              }
            >
              {acceptance.uncertain ? "Retry category acceptance" : "Accept suggested category"}
            </Button>
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No category suggestion.</p>
      )}
      <Button
        variant="outline"
        disabled={
          !settings.data?.enabled ||
          request.mutation.isPending ||
          run?.status === "pending" ||
          run?.status === "running"
        }
        onClick={() =>
          request.submit({ commandId: CommandId.make(crypto.randomUUID()), eventIds: [eventId] })
        }
      >
        {request.uncertain ? "Retry suggestion" : "Suggest a category"}
      </Button>
      {request.mutation.data && (
        <output className="block text-sm">
          {run?.status ?? "Requested"} · {run?.processed ?? 0} of {request.mutation.data.requested}{" "}
          events.
        </output>
      )}
      {run?.failure && <p role="alert">{run.failure}</p>}
      {[
        query.error,
        settings.error,
        runs.error,
        references.error,
        acceptance.mutation.error,
        request.mutation.error,
      ]
        .filter((error) => error !== null)
        .map((error, index) => (
          <p key={index} role="alert">
            {error.message}
          </p>
        ))}
    </section>
  );
}
