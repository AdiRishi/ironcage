import type { RuleSummary } from "@ironcage/contracts/schema";
import { newRequestId, type RulePredicate } from "@ironcage/domain";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader } from "@ironcage/ui/components/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ironcage/ui/components/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";

import { keys } from "@/data/keys";
import { Eyebrow } from "@/features/money/components/eyebrow";
import { formatAud } from "@/features/money/format";
import { decodeRuleOutcome, encodeEditRulePayload } from "@/features/money/transport";
import { editCategorizationRule } from "@/server/money";

const describePredicate = (predicate: RulePredicate): string => {
  const parts: string[] = [];
  if (predicate.payeeEquals !== undefined) parts.push(`payee is "${predicate.payeeEquals}"`);
  if (predicate.narrativeContains !== undefined) {
    parts.push(`narrative has ${predicate.narrativeContains.map((t) => `"${t}"`).join(", ")}`);
  }
  if (predicate.direction !== undefined) {
    parts.push(predicate.direction === "debit" ? "money out" : "money in");
  }
  if (predicate.minAbsoluteAmount !== undefined) {
    parts.push(`at least ${formatAud(predicate.minAbsoluteAmount, { sign: "none" })}`);
  }
  if (predicate.maxAbsoluteAmount !== undefined) {
    parts.push(`at most ${formatAud(predicate.maxAbsoluteAmount, { sign: "none" })}`);
  }
  return parts.join(" · ");
};

/**
 * Rules run before AI and file matching rows without a queue stop. Closing
 * one only stops it matching from now on — nothing already filed moves.
 */
export function RulesCard({ rules }: { readonly rules: readonly RuleSummary[] }) {
  const queryClient = useQueryClient();
  const active = rules.filter((rule) => rule.effectiveTo === null);

  const close = useMutation({
    mutationFn: async (ruleId: RuleSummary["id"]) =>
      decodeRuleOutcome(
        await editCategorizationRule({
          data: encodeEditRulePayload({
            requestId: newRequestId(),
            action: { kind: "close", ruleId },
          }),
        }),
      ),
    onSuccess: async (outcome) => {
      if (outcome.outcome === "ok") {
        await queryClient.invalidateQueries({ queryKey: keys.money("rules") });
      }
    },
  });

  return (
    <Card>
      <CardHeader>
        <Eyebrow>Rules</Eyebrow>
        <CardDescription>
          Created when you tick "always" on a correction. A rule files future rows only; closing it
          moves nothing that's already filed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules yet — correct a payee in the queue above and tick "always" to make one.
          </p>
        ) : (
          active.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-row-hover"
            >
              <span className="min-w-0 truncate text-sm">
                <span className="font-mono text-xs text-muted-foreground">
                  {describePredicate(rule.predicate)}
                </span>
                <span className="mx-2 text-ink-faint">→</span>
                {rule.categoryName}
                {rule.createdBy === "correction" ? (
                  <Badge variant="ghost" className="ml-2 font-mono text-[10px] text-ink-faint">
                    from a correction
                  </Badge>
                ) : null}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Close rule"
                      disabled={close.isPending}
                      onClick={() => close.mutate(rule.id)}
                    >
                      <XIcon />
                    </Button>
                  }
                />
                <TooltipContent>Stop this rule matching future rows</TooltipContent>
              </Tooltip>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
