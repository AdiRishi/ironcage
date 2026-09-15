import {
  type ListReviewItems,
  type ReviewItem,
  type ReviewResolution,
} from "@repo/contracts/finance";
import { formatMoney } from "@repo/finance";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";

import { InterpretationReviewSection } from "../relationships/reviews";
import { reviewQueryOptions } from "./queries";
import { ReviewCard } from "./review-card";

export function ReviewPage({ filter }: { filter: Omit<typeof ListReviewItems.Type, "cursor"> }) {
  const history = useSuspenseInfiniteQuery(reviewQueryOptions(filter));
  const reviews = history.data.pages.flatMap((page) => page.rows);
  const { importId } = filter;
  const heading = useRef<HTMLHeadingElement>(null);
  const previousCount = useRef(reviews.length);
  useEffect(() => {
    if (reviews.length < previousCount.current) heading.current?.focus();
    previousCount.current = reviews.length;
  }, [reviews.length]);
  return (
    <div className="space-y-8">
      <InterpretationReviewSection />
      <header>
        <h1 ref={heading} tabIndex={-1} className="text-3xl font-semibold tracking-tight">
          Source review
        </h1>
        <p className="mt-2 text-muted-foreground">
          Check the source evidence and choose what should be recorded.
        </p>
      </header>
      <Link
        to="/transactions"
        search={{ interpretationReview: true }}
        className="text-primary underline"
      >
        Review financial interpretations
      </Link>
      <nav aria-label="Review status" className="flex gap-4">
        <Link
          to="/review"
          search={{ ...filter, open: true }}
          className={
            filter.open !== false ? "font-medium text-primary underline" : "text-muted-foreground"
          }
        >
          Open
        </Link>
        <Link
          to="/review"
          search={{ ...filter, open: false }}
          className={
            filter.open === false ? "font-medium text-primary underline" : "text-muted-foreground"
          }
        >
          Resolved
        </Link>
      </nav>
      {importId && (
        <Link to="/review" className="text-primary underline">
          Show all reviews
        </Link>
      )}
      {reviews.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>
              {filter.open === false ? "No resolved reviews" : "Nothing to review"}
            </EmptyTitle>
            <EmptyDescription>
              {filter.open === false
                ? "Your decisions will appear here."
                : "All imported source rows have been accounted for."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/transactions" className="text-primary underline">
              View transactions
            </Link>
          </EmptyContent>
        </Empty>
      ) : (
        reviews.map((review) =>
          review.resolution ? (
            <ResolvedReview key={review.id} review={review} resolution={review.resolution} />
          ) : (
            <ReviewCard key={review.id} review={review} />
          ),
        )
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            history.fetchNextPage().catch(reportError);
          }}
        >
          Load more reviews
        </Button>
      )}
    </div>
  );
}
function ResolvedReview({
  review,
  resolution,
}: {
  review: ReviewItem;
  resolution: typeof ReviewResolution.Type;
}) {
  return (
    <section className="space-y-3 rounded-lg border p-5">
      <p className="text-sm break-all text-muted-foreground">{review.fileName}</p>
      <h2 className="font-semibold">{review.question.message}</h2>
      {resolution.kind === "account" ? (
        <p className="text-sm">Account confirmed.</p>
      ) : (
        resolution.decisions.map(({ observationId, decision }) => (
          <p key={observationId} className="text-sm">
            {decision.kind === "omit"
              ? `Omitted: ${decision.reason}`
              : decision.kind === "distinct"
                ? "Recorded as a distinct transaction."
                : decision.kind === "match"
                  ? "Matched to an existing transaction."
                  : `${decision.kind === "keep" ? "Kept accepted values" : "Corrected values"}: ${decision.candidate.postedOn} · ${formatMoney(decision.candidate.amount)} · ${decision.candidate.description}`}
          </p>
        ))
      )}
      <Link
        to="/transactions"
        search={{ importId: review.importId }}
        className="text-sm text-primary underline"
      >
        View supporting transactions
      </Link>
    </section>
  );
}
