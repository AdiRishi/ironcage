import type {
  TransferCandidateGroup,
  TransferLeg,
  TransferMatchSummary,
} from "@ironcage/contracts/schema";
import { Alert, AlertDescription, AlertTitle } from "@ironcage/ui/components/alert";
import { Button } from "@ironcage/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@ironcage/ui/components/card";
import { Separator } from "@ironcage/ui/components/separator";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BigDecimal } from "effect";
import { ArrowRightLeftIcon, CircleAlertIcon } from "lucide-react";

import { keys } from "@/data/keys";
import {
  decodeTransferOutcome,
  encodeDecideTransferPayload,
  mintRequestId,
} from "@/features/money/codec";
import { describeError, formatAud, formatDay } from "@/features/money/format";
import { decideTransferMatch } from "@/server/money";

function Leg({ leg }: { readonly leg: TransferLeg }) {
  return (
    <span className="font-mono text-xs">
      <span className="text-foreground">{leg.productLabel}</span>
      <span className="text-muted-foreground">
        {" "}
        · {formatDay(leg.postedDate)} · {formatAud(leg.amount, { sign: "always" })}
      </span>
    </span>
  );
}

/**
 * Matching a transfer's two legs removes both from income and spending, so a
 * candidate with several plausible counterparts is the operator's call —
 * exactly like an ambiguous import row, it never resolves itself.
 */
export function TransferQueue({
  unresolved,
  matches,
}: {
  readonly unresolved: readonly TransferCandidateGroup[];
  readonly matches: readonly TransferMatchSummary[];
}) {
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: async (input: {
      readonly transactionA: TransferLeg["transactionId"];
      readonly transactionB: TransferLeg["transactionId"];
      readonly decision: "confirm" | "dismiss";
    }) =>
      decodeTransferOutcome(
        await decideTransferMatch({
          data: encodeDecideTransferPayload({ requestId: mintRequestId(), ...input }),
        }),
      ),
    onSuccess: (outcome) => {
      if (outcome.outcome === "ok") {
        void queryClient.invalidateQueries({ queryKey: keys.moneyAll() });
      }
    },
  });

  const confirmed = matches.filter((match) => match.status === "confirmed");
  const decideError =
    decide.data?.outcome === "error"
      ? describeError(decide.data.error)
      : decide.error !== null
        ? String(decide.error)
        : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-lg tracking-tight">
          Transfers between your accounts
        </CardTitle>
        <CardDescription>
          A matched pair is one movement of your own money — neither leg counts as spending or
          income.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {unresolved.length === 0 ? (
          <p className="text-sm text-muted-foreground">No pairings waiting on you.</p>
        ) : (
          unresolved.map((group) => (
            <div
              key={group.transaction.transactionId}
              className="flex flex-col gap-2.5 rounded-lg border border-warning/40 p-4"
            >
              <div className="flex flex-col gap-0.5">
                <Leg leg={group.transaction} />
                <span className="truncate font-mono text-xs text-ink-faint">
                  {group.transaction.narrative}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {group.counterparts.length === 1
                  ? "One possible counterpart:"
                  : `${group.counterparts.length} possible counterparts — at most one can be the other leg:`}
              </p>
              {group.counterparts.map((counterpart) => (
                <div
                  key={counterpart.transactionId}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <Leg leg={counterpart} />
                    <span className="truncate font-mono text-xs text-ink-faint">
                      {counterpart.narrative}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          transactionA: group.transaction.transactionId,
                          transactionB: counterpart.transactionId,
                          decision: "dismiss",
                        })
                      }
                    >
                      Not a pair
                    </Button>
                    <Button
                      size="xs"
                      disabled={decide.isPending}
                      onClick={() =>
                        decide.mutate({
                          transactionA: group.transaction.transactionId,
                          transactionB: counterpart.transactionId,
                          decision: "confirm",
                        })
                      }
                    >
                      Confirm transfer
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
        {decideError === undefined ? null : (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>The decision didn't land</AlertTitle>
            <AlertDescription>{decideError}</AlertDescription>
          </Alert>
        )}
        {confirmed.length > 0 ? (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] tracking-[0.14em] text-ink-faint uppercase">
                Matched
              </span>
              {confirmed.slice(0, 8).map((match) => (
                <span key={match.id} className="flex items-center gap-2 font-mono text-xs">
                  <ArrowRightLeftIcon className="size-3.5 shrink-0 text-ink-faint" />
                  <span>
                    {match.a.productLabel} ↔ {match.b.productLabel}
                    <span className="text-muted-foreground">
                      {" "}
                      · {formatAud(BigDecimal.abs(match.a.amount), { sign: "none" })} ·{" "}
                      {formatDay(match.a.postedDate)}
                      {match.method === "operator" ? " · you decided" : ""}
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
