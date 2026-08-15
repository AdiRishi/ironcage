import { newRequestId } from "@ironcage/domain";
import { Button } from "@ironcage/ui/components/button";
import { Spinner } from "@ironcage/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";

import { keys } from "@/data/keys";
import { describeError } from "@/features/money/format";
import {
  decodeRetryCategorizationOutcome,
  encodeRetryCategorizationPayload,
} from "@/features/money/transport";
import { retryCategorization } from "@/server/money";

export function RetryCategorization({ transactionCount }: { readonly transactionCount: number }) {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: async () =>
      decodeRetryCategorizationOutcome(
        await retryCategorization({
          data: encodeRetryCategorizationPayload({ requestId: newRequestId() }),
        }),
      ),
    onSuccess: async (outcome) => {
      if (outcome.outcome === "ok") {
        await queryClient.invalidateQueries({ queryKey: keys.moneyAll() });
      }
    },
  });
  const categorizationRunning =
    retry.data?.outcome === "ok" && retry.data.value.transactions > 0 && transactionCount > 0;

  useEffect(() => {
    if (!categorizationRunning) return;

    const interval = window.setInterval(() => {
      queryClient
        .invalidateQueries({ queryKey: keys.ledger({ kind: "attention" }) })
        .catch(() => undefined);
    }, 2_000);
    const timeout = window.setTimeout(() => window.clearInterval(interval), 10 * 60_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [categorizationRunning, queryClient]);

  const message =
    retry.data?.outcome === "error"
      ? describeError(retry.data.error)
      : retry.error !== null
        ? String(retry.error)
        : retry.data?.outcome === "ok"
          ? retry.data.value.transactions === 0
            ? "No unfinished AI batches to retry."
            : `${retry.data.value.transactions} ${retry.data.value.transactions === 1 ? "row" : "rows"} ${transactionCount === 0 ? "filed" : "submitted"}.`
          : undefined;
  const failed = retry.data?.outcome === "error" || retry.error !== null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {message === undefined ? null : (
        <span
          className={failed ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
          aria-live="polite"
        >
          {message}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={transactionCount === 0 || retry.isPending}
        onClick={() => retry.mutate()}
      >
        {retry.isPending ? <Spinner /> : <RefreshCwIcon />}
        Retry all with AI
      </Button>
    </div>
  );
}
