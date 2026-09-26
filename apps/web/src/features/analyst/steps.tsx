import type { TurnStep } from "@repo/contracts/analyst";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

import { recordLink } from "./record-link";

// What the analyst has read so far, in order, while it works. Nothing moves by itself, so
// the last step's ellipsis says it is still working.
export function StepsSoFar({ steps }: { steps: ReadonlyArray<TurnStep> }) {
  if (steps.length === 0) return <p className="type-small text-slate">Reading the question…</p>;
  return (
    <ol className="space-y-1 type-small text-slate">
      {steps.map((step, index) => (
        <li key={index}>
          {step.label}
          {index === steps.length - 1 && "…"}
        </li>
      ))}
    </ol>
  );
}

// Every read behind an answer, each linked to the screen that shows the same read.
export function WorkedOut({ steps }: { steps: ReadonlyArray<TurnStep> }) {
  if (steps.length === 0) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-2 rounded-sm text-left type-small text-slate hover:text-intaglio">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 transition-transform group-data-panel-open:rotate-90"
        />
        How this was worked out
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 list-decimal space-y-1 pl-10 type-small">
          {steps.map((step, index) => (
            <li key={index}>
              {step.records ? (
                <Link {...recordLink(step.records)} className="underline underline-offset-4">
                  {step.label}
                </Link>
              ) : (
                step.label
              )}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
