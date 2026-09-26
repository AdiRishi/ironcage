import type { ConversationId, Turn } from "@repo/contracts/analyst";
import { Link } from "@tanstack/react-router";
import { type Ref, useId } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFocusRequest } from "@/lib/use-focus-request";

import { AnswerText, citationsOf } from "./answer-text";
import { BasisLine, Limits } from "./basis";
import { ContextChip } from "./context";
import { ProposalCard } from "./proposal-card";
import { StepsSoFar, WorkedOut } from "./steps";
import { useAsk } from "./use-ask";

// One question and what became of it. `outcome` is the answer with the changes it
// proposes, or the reason there is none, which takes focus when the analyst finishes.
export function TurnView({
  turn,
  conversationId,
  answering,
  outcome,
}: {
  turn: Turn;
  conversationId: ConversationId;
  // Whether a question in the conversation is still waiting, so none can be asked again.
  answering: boolean;
  outcome: Ref<HTMLElement>;
}) {
  const id = useId();
  return (
    <article aria-labelledby={`${id}-question`} className="space-y-3">
      <div className="space-y-1.5">
        <h2 id={`${id}-question`} className="type-small whitespace-pre-line text-slate">
          {turn.question}
        </h2>
        {turn.context && <ContextChip context={turn.context} />}
      </div>
      <Outcome turn={turn} conversationId={conversationId} answering={answering} ref={outcome} />
    </article>
  );
}

function Outcome({
  turn,
  conversationId,
  answering,
  ref,
}: {
  turn: Turn;
  conversationId: ConversationId;
  answering: boolean;
  ref: Ref<HTMLElement>;
}) {
  const id = useId();
  switch (turn.status) {
    case "queued":
      return <p className="type-small text-slate">Waiting for the analyst to start…</p>;
    case "running":
      return <StepsSoFar steps={turn.steps} />;
    case "answered": {
      if (!turn.answer) return null;
      const cited = citationsOf(turn.answer);
      return (
        <section ref={ref} tabIndex={-1} aria-labelledby={`${id}-answer`} className="space-y-4">
          <h3 id={`${id}-answer`} className="sr-only">
            Answer
          </h3>
          <div className="max-w-prose space-y-3">
            <AnswerText text={turn.answer.text} cited={cited} />
          </div>
          {turn.answer.missing.length > 0 && (
            <div className="max-w-prose space-y-1">
              <h4 className="type-small font-[560]">What your records cannot answer</h4>
              <ul className="list-disc space-y-1 pl-5 type-small">
                {turn.answer.missing.map((text, index) => (
                  <li key={index}>
                    <AnswerText text={text} cited={cited} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {turn.answer.proposals.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              conversationId={conversationId}
              cited={cited}
            />
          ))}
          <div className="space-y-2">
            {turn.answer.basis && <BasisLine basis={turn.answer.basis} />}
            <Limits limits={turn.answer.limits} cited={cited} />
          </div>
          <WorkedOut steps={turn.steps} />
        </section>
      );
    }
    case "blocked":
    case "failed":
      return (
        <section ref={ref} tabIndex={-1} aria-labelledby={`${id}-none`} className="space-y-3">
          <h3 id={`${id}-none`} className="sr-only">
            No answer
          </h3>
          <p>{turn.message}</p>
          {turn.status === "blocked" ? (
            <p>
              <Link to="/settings" className="underline underline-offset-4">
                Open Settings
              </Link>
            </p>
          ) : (
            <AskAgain turn={turn} conversationId={conversationId} answering={answering} />
          )}
          <WorkedOut steps={turn.steps} />
        </section>
      );
  }
}

// Asks the same question about the same selection as a new question in the conversation.
// Asking disables the button, so a question that could not be asked returns focus to it.
function AskAgain({
  turn,
  conversationId,
  answering,
}: {
  turn: Turn;
  conversationId: ConversationId;
  answering: boolean;
}) {
  const [button, focusButton] = useFocusRequest<HTMLButtonElement>({ onlyWhenLost: true });
  const command = useAsk(conversationId, { onFailed: focusButton });
  const { mutation, uncertain } = command;
  return (
    <div className="space-y-2">
      <Button
        ref={button}
        variant="outline"
        size="sm"
        disabled={mutation.isPending || answering}
        onClick={() => command.ask(turn.question, turn.context)}
      >
        {mutation.isPending ? "Asking…" : uncertain ? "Retry" : "Ask again"}
      </Button>
      {mutation.error && (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
