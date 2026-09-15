import {
  CommandId,
  DismissInterpretationReview,
  ListInterpretationReviews,
  ProposeRelationships,
  type InterpretationReviewCursor,
} from "@repo/contracts/finance";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";
import { callApiRpc } from "@/server/api-client.server";

import { RelatedEvent } from "./panel";
const list = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListInterpretationReviews))
  .handler(({ data }) => callApiRpc((client) => client.listInterpretationReviews(data)));
const propose = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ProposeRelationships))
  .handler(({ data }) => callApiRpc((client) => client.proposeRelationships(data)));
const dismiss = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DismissInterpretationReview))
  .handler(({ data }) => callApiRpc((client) => client.dismissInterpretationReview(data)));
export function InterpretationReviewSection() {
  const client = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["interpretationReviews"],
    initialPageParam: null,
    queryFn: ({ pageParam }: { pageParam: typeof InterpretationReviewCursor.Type | null }) =>
      list({ data: pageParam ? { cursor: pageParam } : {} }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const proposals = useCommand({
    mutationFn: (data: typeof ProposeRelationships.Type) => propose({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  const dismissal = useCommand({
    mutationFn: (data: typeof DismissInterpretationReview.Type) => dismiss({ data }),
    onSuccess: () => client.invalidateQueries(),
  });
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Interpretation review</h2>
        <Button
          variant="outline"
          disabled={proposals.mutation.isPending}
          onClick={() => proposals.submit({ commandId: CommandId.make(crypto.randomUUID()) })}
        >
          {proposals.uncertain ? "Retry proposals" : "Find movement proposals"}
        </Button>
      </div>
      {query.data?.pages
        .flatMap((page) => page.rows)
        .map((row) => (
          <div className="space-y-3 rounded-lg border p-4" key={row.id}>
            <p className="font-medium">
              {row.kind === "role"
                ? "Choose financial role"
                : row.kind === "relationship"
                  ? "Confirm a proposed movement"
                  : "Resolve conflicting rules"}
            </p>
            <p>
              {row.postedOn} · {row.description}
            </p>
            {row.eventIds.map((eventId) => (
              <p key={eventId}>
                <RelatedEvent eventId={eventId} />
              </p>
            ))}
            <div className="flex flex-wrap gap-3">
              <Link className="underline" to="/transactions/$id" params={{ id: row.postingId }}>
                Open interpretation
              </Link>
              {row.kind !== "role" && (
                <Button
                  variant="outline"
                  disabled={dismissal.mutation.isPending}
                  onClick={() =>
                    dismissal.submit({
                      commandId: CommandId.make(crypto.randomUUID()),
                      reviewId: row.id,
                      expectedVersion: row.version,
                    })
                  }
                >
                  {dismissal.uncertain ? "Retry dismissal" : "Dismiss proposal"}
                </Button>
              )}
            </div>
          </div>
        ))}
      {query.isPending && <p>Loading interpretation reviews…</p>}
      {[query.error, proposals.mutation.error, dismissal.mutation.error]
        .filter((error) => error !== null)
        .map((error, index) => (
          <p role="alert" key={index}>
            {error.message}
          </p>
        ))}
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => {
            query.fetchNextPage().catch(reportError);
          }}
        >
          More interpretation reviews
        </Button>
      )}
    </section>
  );
}
