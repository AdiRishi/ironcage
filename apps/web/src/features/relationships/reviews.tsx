import {
  ApplyRelationship,
  CommandId,
  DismissInterpretationReview,
  RelationshipChange,
  type RelationshipProposal,
  ListInterpretationReviews,
  ProposeRelationships,
  type InterpretationReviewCursor,
} from "@repo/contracts/finance";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Effect, Schema } from "effect";

import { Button } from "@/components/ui/button";
import { useCommand } from "@/lib/use-command";
import { callApiRpc } from "@/server/api-client.server";

import { applyRelationship, previewRelationship } from "./functions";
import { RelatedEvent } from "./panel";

type CreditProposalLink = Extract<typeof RelationshipProposal.Type, { kind: "credit" }>["link"];
const list = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(ListInterpretationReviews))
  .handler(({ data }) => callApiRpc((client) => client.listInterpretationReviews(data)));
const propose = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(ProposeRelationships))
  .handler(({ data }) => callApiRpc((client) => client.proposeRelationships(data)));
const dismiss = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(DismissInterpretationReview))
  .handler(({ data }) => callApiRpc((client) => client.dismissInterpretationReview(data)));
export function RelationshipProposals() {
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
  const rows = query.data?.pages.flatMap((page) => page.rows) ?? [];
  const movements = rows.filter((row) => row.proposal.kind === "movement");
  const credits = rows.flatMap((row) =>
    row.proposal.kind === "credit" ? [{ ...row, link: row.proposal.link }] : [],
  );
  const dismissButton = (row: (typeof rows)[number], label: string) => (
    <Button
      variant="ghost"
      size="sm"
      disabled={dismissal.mutation.isPending}
      onClick={() =>
        dismissal.submit({
          commandId: CommandId.make(crypto.randomUUID()),
          reviewId: row.id,
          expectedVersion: row.version,
        })
      }
    >
      {dismissal.uncertain ? "Retry" : label}
    </Button>
  );
  return (
    <>
      {credits.length > 0 && (
        <section aria-labelledby="credits-heading" className="space-y-4 border-t border-rule pt-8">
          <div>
            <h2 id="credits-heading" className="type-heading">
              Refunds to link
            </h2>
            <p className="mt-1 type-small text-slate">
              Each credit looks like it returns the purchase under it. Linking moves the credit into
              that purchase's category and month.
            </p>
          </div>
          <ul className="divide-y divide-rule border-y border-rule">
            {credits.map((row) => (
              <li className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center" key={row.id}>
                <div className="min-w-0 space-y-1 type-small">
                  {row.eventIds.map((eventId) => (
                    <p key={eventId} className="truncate">
                      <RelatedEvent eventId={eventId} />
                    </p>
                  ))}
                </div>
                <div className="flex gap-2">
                  <LinkCredit link={row.link} />
                  {dismissButton(row, "Not related")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="movements-heading" className="space-y-4 border-t border-rule pt-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="movements-heading" className="type-heading">
              Movements to confirm
            </h2>
            <p className="mt-1 type-small text-slate">
              Pairs that look like money moving between your own accounts. Confirmed pairs leave
              both spending and income.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={proposals.mutation.isPending}
            onClick={() => proposals.submit({ commandId: CommandId.make(crypto.randomUUID()) })}
          >
            {proposals.uncertain ? "Retry" : "Look for more"}
          </Button>
        </div>
        {query.isSuccess && movements.length === 0 && (
          <p className="text-slate">No movements are waiting.</p>
        )}
        <ul className="divide-y divide-rule border-y border-rule">
          {movements.map((row) => (
            <li className="grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center" key={row.id}>
              <div className="min-w-0 space-y-1 type-small">
                {row.eventIds.map((eventId) => (
                  <p key={eventId} className="truncate">
                    <RelatedEvent eventId={eventId} />
                  </p>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  nativeButton={false}
                  render={<Link to="/ledger/$id" params={{ id: row.postingId }} />}
                >
                  Review
                </Button>
                {dismissButton(row, "Not a movement")}
              </div>
            </li>
          ))}
        </ul>
        {query.isPending && <p className="text-slate">Loading…</p>}
        {[query.error, proposals.mutation.error, dismissal.mutation.error]
          .filter((error) => error !== null)
          .map((error, index) => (
            <p role="alert" className="type-small text-attention" key={index}>
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
            More movements
          </Button>
        )}
      </section>
    </>
  );
}

// Links a proposed credit to its purchase for the proposed amount, through the same
// preview and command as linking it by hand.
function LinkCredit({ link }: { link: CreditProposalLink }) {
  const client = useQueryClient();
  const preview = useMutation({
    mutationFn: async (change: RelationshipChange) =>
      previewRelationship({
        data: { change: await Effect.runPromise(Schema.encodeEffect(RelationshipChange)(change)) },
      }),
  });
  const { mutation, submit, retry, uncertain } = useCommand({
    mutationFn: async (data: typeof ApplyRelationship.Type) =>
      applyRelationship({
        data: await Effect.runPromise(Schema.encodeEffect(ApplyRelationship)(data)),
      }),
    onSuccess: () => client.invalidateQueries(),
  });
  const change = { kind: "linkCredit", ...link } satisfies RelationshipChange;
  const error = preview.error ?? mutation.error;
  return (
    <>
      <Button
        size="sm"
        disabled={preview.isPending || mutation.isPending}
        onClick={() => {
          if (uncertain) {
            retry();
            return;
          }
          preview
            .mutateAsync(change)
            .then((result) =>
              submit({
                commandId: CommandId.make(crypto.randomUUID()),
                change,
                expectedVersions: result.expectedVersions,
              }),
            )
            .catch(reportError);
        }}
      >
        {uncertain ? "Retry" : "Link"}
      </Button>
      {error && (
        <p role="alert" className="type-small text-attention">
          {error.message}
        </p>
      )}
    </>
  );
}
