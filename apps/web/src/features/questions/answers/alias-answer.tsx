import { Accept, AnswerActions, type AnswerProps, AnswerPreview } from "./answer-actions";
import { IdentifyForm, identifyDescriptor } from "./identify-form";
import { useAnswer } from "./use-answer";

// A descriptor the model thinks belongs to a counterparty. Yes moves it there. Someone else
// moves it to a counterparty you have, the proposed one included, or to a new one.
export function AliasAnswer({ question, references, onSkip, onAnswered }: AnswerProps<"alias">) {
  const [answer, { acceptRef, submitRef, applyRef }] = useAnswer(onAnswered);
  const identify = identifyDescriptor(question.aliasKey, question.aliasVersion);
  return (
    <div className="space-y-4">
      <AnswerActions
        accept={
          <Accept
            answer={answer}
            acceptRef={acceptRef}
            change={identify({ kind: "existing", counterparty: question.counterparty })}
          >
            Yes, it's {question.counterparty.name}
          </Accept>
        }
        other="Someone else"
        onSkip={onSkip}
        disabled={answer.busy}
      >
        <IdentifyForm
          answer={answer}
          submitRef={submitRef}
          references={references}
          excluding={null}
          initial={{ identity: null, kind: "business", defaultRole: null, defaultCategoryId: null }}
          toChange={identify}
        />
      </AnswerActions>
      <AnswerPreview answer={answer} applyRef={applyRef} />
    </div>
  );
}
