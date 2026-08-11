import { uncategorizedCategoryId, type CategorizationReviewItem } from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@ironcage/ui/components/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ironcage/ui/components/select";
import { Spinner } from "@ironcage/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BigDecimal, Schema } from "effect";
import { useState } from "react";

import { keys } from "@/data/keys";
import { CallFailure, Panel, PanelSkeleton } from "@/features/money/components/money-panels";
import { fullDayLabel, signedAud } from "@/features/money/format";
import { categoriesQuery, reviewQueueQuery, unwrap } from "@/features/money/queries";
import { newRequestId } from "@/lib/request-id";
import { categorizeTransactions } from "@/server/money";

/** Core accepts 200 assignments in one request, which is the batch size here. */
const batchLimit = 200;

/**
 * The review queue: every transaction no rule recognised, waiting on a category.
 *
 * Assignments are collected and sent as one request rather than one per row.
 * The split for an unsplit transaction is its whole signed amount, which is the
 * invariant core enforces on the way in — a split set that does not total the
 * transaction is refused rather than stored.
 */
export function ReviewQueue() {
  const queryClient = useQueryClient();
  const queue = useQuery(reviewQueueQuery);
  const categories = useQuery(categoriesQuery);
  const [chosen, setChosen] = useState<ReadonlyMap<string, string>>(new Map());

  const categorize = useMutation({
    mutationFn: async (
      assignments: readonly {
        readonly transactionId: string;
        readonly splits: readonly { readonly categoryId: string; readonly amount: string }[];
        readonly acceptedSuggestionId: null;
      }[],
    ) =>
      unwrap(Schema.Struct({ requestId: Schema.String }))(
        await categorizeTransactions({ data: { assignments, requestId: newRequestId() } }),
      ),
    onSuccess: () => {
      setChosen(new Map());
      return queryClient.invalidateQueries({ queryKey: keys.money() });
    },
  });

  if (queue.isPending || categories.isPending) return <PanelSkeleton rows={4} />;
  if (queue.isError) return <CallFailure error={queue.error} />;
  if (categories.isError) return <CallFailure error={categories.error} />;

  const assignable = categories.data.filter((category) => category.id !== uncategorizedCategoryId);
  const pending = queue.data.slice(0, batchLimit);
  const assignments = pending.flatMap((item) => {
    const categoryId = chosen.get(item.transactionId);

    return categoryId === undefined
      ? []
      : [
          {
            transactionId: item.transactionId as string,
            splits: [{ categoryId, amount: BigDecimal.format(item.amount) }],
            acceptedSuggestionId: null,
          },
        ];
  });

  return (
    <Panel
      title={`Review queue — ${queue.data.length} waiting`}
      action={
        assignments.length > 0 && (
          <Button
            size="sm"
            disabled={categorize.isPending}
            onClick={() => categorize.mutate(assignments)}
          >
            {categorize.isPending && <Spinner />}
            Apply {assignments.length}
          </Button>
        )
      }
    >
      {categorize.isError && <CallFailure error={categorize.error} />}

      {queue.data.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Nothing is waiting</EmptyTitle>
            <EmptyDescription>
              Every imported transaction carries a category. A row a rule does not recognise arrives
              here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="overflow-hidden rounded-xl border bg-card">
          {pending.map((item) => (
            <ReviewRow
              key={item.transactionId}
              item={item}
              categories={assignable}
              chosen={chosen.get(item.transactionId) ?? ""}
              onChoose={(categoryId) =>
                setChosen((current) => new Map(current).set(item.transactionId, categoryId))
              }
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReviewRow({
  item,
  categories,
  chosen,
  onChoose,
}: {
  readonly item: CategorizationReviewItem;
  readonly categories: readonly { readonly id: string; readonly name: string }[];
  readonly chosen: string;
  readonly onChoose: (categoryId: string) => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border/60 p-4 last:border-0 hover:bg-row-hover">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm" title={item.narrative}>
          {item.narrative}
        </span>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {fullDayLabel(item.postedDate)} · {signedAud(item.amount)}
        </span>
      </div>

      {item.suggestion !== null && (
        <Badge variant="ghost" className="text-ai">
          AI suggests · needs review
        </Badge>
      )}

      <Select value={chosen} onValueChange={(value) => value !== null && onChoose(value)}>
        <SelectTrigger className="w-52">
          <SelectValue placeholder="Choose a category">
            {(value) =>
              categories.find((category) => category.id === value)?.name ?? "Choose a category"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {categories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </li>
  );
}
