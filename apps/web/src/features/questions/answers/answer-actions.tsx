import type { CounterpartyChange, Question, ReferenceData } from "@repo/contracts/finance";
import type { ReactNode, Ref } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChangePreview } from "@/features/counterparties/change-preview";

import type { Answer, FocusRef } from "./use-answer";

export type QuestionOf<Kind extends Question["kind"]> = Extract<Question, { kind: Kind }>;
// What the card gives the answer to each kind of question.
export type AnswerProps<Kind extends Question["kind"]> = {
  question: QuestionOf<Kind>;
  references: typeof ReferenceData.Type;
  onSkip: () => void;
  onAnswered: () => void;
};

// Accept applies the proposal, `other` opens an answer of your own in place, and Skip
// leaves the question open for later.
export function AnswerActions({
  accept,
  other,
  otherRef,
  open,
  onOpenChange,
  onSkip,
  disabled,
  children,
}: {
  accept?: ReactNode;
  other: string;
  otherRef?: Ref<HTMLButtonElement>;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  onSkip: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} disabled={disabled} className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {accept}
        <CollapsibleTrigger ref={otherRef} render={<Button variant="outline" size="sm" />}>
          {other}
        </CollapsibleTrigger>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onSkip}>
          Skip
        </Button>
      </div>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

// Previews the proposal.
export function Accept({
  answer,
  acceptRef,
  change,
  children,
}: {
  answer: Answer;
  acceptRef: FocusRef;
  change: CounterpartyChange;
  children: ReactNode;
}) {
  return (
    <Button ref={acceptRef} size="sm" disabled={answer.busy} onClick={() => answer.accept(change)}>
      {children}
    </Button>
  );
}

// What an answer changes, with Apply to save it.
export function AnswerPreview({ answer, applyRef }: { answer: Answer; applyRef: FocusRef }) {
  const { change } = answer;
  const previewed = change.previewed;
  return (
    <>
      {change.previewing && (
        <output className="block type-small text-slate">Calculating the effect…</output>
      )}
      {change.pending && !change.previewing && !previewed && (
        <output className="block type-small text-slate">Saving your answer…</output>
      )}
      {change.error && (
        <Alert variant="destructive">
          <AlertDescription>{change.error.message}</AlertDescription>
        </Alert>
      )}
      {previewed && (
        <div className="space-y-3">
          <ChangePreview eventCount={previewed.eventCount} impacts={previewed.impacts} />
          <div className="flex flex-wrap gap-2">
            <Button
              ref={applyRef}
              size="sm"
              disabled={change.pending}
              focusableWhenDisabled
              onClick={() => {
                change.confirm();
              }}
            >
              {change.pending
                ? "Saving…"
                : change.uncertain
                  ? "Retry"
                  : applyLabel(previewed.eventCount)}
            </Button>
            <Button size="sm" variant="ghost" disabled={answer.busy} onClick={answer.cancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function applyLabel(eventCount: number) {
  if (eventCount === 0) return "Save";
  if (eventCount === 1) return "Apply to the one transaction";
  return `Apply to all ${eventCount} transactions`;
}
