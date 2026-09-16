import { CommandId, type AcceptSuggestions, type EventId } from "@repo/contracts/finance";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useCommand } from "@/lib/use-command";

import { referenceDataQuery } from "../events/queries";
import { RelatedEvent } from "../relationships/panel";
import { acceptSuggestions, listSuggestions } from "./functions";
import { useClassificationRuns } from "./queries";

export function SuggestionsPage() {
  const query = useQuery({ queryKey: ["suggestions"], queryFn: () => listSuggestions() });
  const runs = useClassificationRuns();
  const references = useQuery(referenceDataQuery());
  const [limit, setLimit] = useState(50);
  const [selected, setSelected] = useState<readonly (typeof EventId.Type)[]>([]);
  const client = useQueryClient();
  const command = useCommand({
    mutationFn: (data: typeof AcceptSuggestions.Type) => acceptSuggestions({ data }),
    onSuccess: async () => {
      setSelected([]);
      await client.invalidateQueries();
    },
  });
  const accept = (ids: readonly (typeof EventId.Type)[]) => {
    const [first, ...rest] = (query.data ?? [])
      .filter((row) => ids.includes(row.eventId) && row.suggestion.categoryId !== null)
      .map((row) => ({ eventId: row.eventId, version: row.suggestion.eventVersion }));
    if (first)
      command.submit({
        commandId: CommandId.make(crypto.randomUUID()),
        expectedVersions: [first, ...rest],
      });
  };
  return (
    <div className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-3xl font-semibold">Category suggestions</h1>
        <p className="mt-2 text-muted-foreground">
          Review the proposed categories. Changed events and specific corrections are skipped during
          acceptance.
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() =>
            setSelected(
              (query.data ?? [])
                .slice(0, limit)
                .filter((row) => row.suggestion.categoryId !== null)
                .map((row) => row.eventId),
            )
          }
        >
          Select visible suggestions
        </Button>
        <Button
          disabled={!selected.length || command.mutation.isPending}
          onClick={() => accept(selected)}
        >
          {command.uncertain ? "Retry acceptance" : `Accept ${selected.length} selected`}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            query.refetch().catch(reportError);
          }}
        >
          Refresh suggestions
        </Button>
      </div>
      {query.data?.slice(0, limit).map((row) => (
        <section className="space-y-3 rounded-lg border p-5" key={row.eventId}>
          <div className="flex flex-wrap justify-between gap-3">
            <RelatedEvent eventId={row.eventId} />
            {row.suggestion.categoryId && (
              <Label>
                <Checkbox
                  checked={selected.includes(row.eventId)}
                  onCheckedChange={(checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, row.eventId]
                        : current.filter((id) => id !== row.eventId),
                    )
                  }
                />
                Select suggestion
              </Label>
            )}
          </div>
          <p className="font-medium">
            {row.suggestion.categoryId
              ? (references.data?.categories.find(
                  (category) => category.id === row.suggestion.categoryId,
                )?.name ?? "Category no longer available")
              : "Needs review"}
          </p>
          <p className="text-sm text-muted-foreground">{row.suggestion.reason}</p>
          {row.suggestion.categoryId && (
            <Button
              variant="outline"
              disabled={command.mutation.isPending}
              onClick={() => accept([row.eventId])}
            >
              Accept category
            </Button>
          )}
        </section>
      ))}
      {query.data?.length === 0 && (
        <p>
          No suggestions to review. Request them in Settings, or categorize transactions manually.
        </p>
      )}
      {query.data && query.data.length > limit && (
        <Button variant="outline" onClick={() => setLimit((value) => value + 50)}>
          More suggestions
        </Button>
      )}
      {command.mutation.data && (
        <output>
          {command.mutation.data.accepted} accepted · {command.mutation.data.skipped} skipped
        </output>
      )}
      {[runs.error, query.error, references.error, command.mutation.error]
        .filter((error) => error !== null)
        .map((error, index) => (
          <p key={index} role="alert">
            {error.message}
          </p>
        ))}
    </div>
  );
}
