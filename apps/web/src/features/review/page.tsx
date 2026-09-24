import type { ImportId } from "@repo/contracts/finance";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";

import { reviewQueryOptions } from "./queries";
import { ReviewCard } from "./review-card";

// Rows from imported files that could not be recorded without a decision.
export function SourceReviews({ importId }: { importId: typeof ImportId.Type | undefined }) {
  const history = useSuspenseInfiniteQuery(
    reviewQueryOptions(importId ? { importId, open: true } : { open: true }),
  );
  const reviews = history.data.pages.flatMap((page) => page.rows);
  if (reviews.length === 0 && !importId) return null;
  return (
    <section
      aria-labelledby="source-reviews-heading"
      className="space-y-4 border-t border-rule pt-8"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="source-reviews-heading" className="type-heading">
            Records to check
          </h2>
          <p className="mt-1 type-small text-slate">
            Rows from your files that could be read more than one way.
          </p>
        </div>
        {importId && (
          <Link to="/questions" className="type-small underline underline-offset-4">
            Show every file
          </Link>
        )}
      </div>
      {reviews.length === 0 ? (
        <p className="text-slate">Every row in this file is accounted for.</p>
      ) : (
        reviews.map((review) => <ReviewCard key={review.id} review={review} />)
      )}
      {history.hasNextPage && (
        <Button
          variant="outline"
          disabled={history.isFetchingNextPage}
          onClick={() => {
            history.fetchNextPage().catch(reportError);
          }}
        >
          More records
        </Button>
      )}
    </section>
  );
}
