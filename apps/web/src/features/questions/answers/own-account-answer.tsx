import { accountName } from "../describe";
import { Accept, AnswerActions, type AnswerProps, AnswerPreview } from "./answer-actions";
import { IdentifyForm, identifyDescriptor } from "./identify-form";
import { useAnswer } from "./use-answer";

// Transfers to an account number that is none of your accounts. Yes makes it your own
// account elsewhere. Someone else names whose it is, and a new person needs a role.
export function OwnAccountAnswer({
  question,
  references,
  onSkip,
  onAnswered,
}: AnswerProps<"ownAccount">) {
  const [answer, { acceptRef, submitRef, applyRef }] = useAnswer(onAnswered);
  const identify = identifyDescriptor(question.aliasKey, question.aliasVersion);
  return (
    <div className="space-y-4">
      <AnswerActions
        accept={
          <Accept
            answer={answer}
            acceptRef={acceptRef}
            change={identify({
              kind: "new",
              fields: {
                name: accountName(question.aliasKey),
                kind: "ownAccount",
                brand: null,
                defaultRole: null,
                defaultCategoryId: null,
              },
            })}
          >
            Yes, it's mine
          </Accept>
        }
        other="It belongs to someone else"
        onSkip={onSkip}
        disabled={answer.busy}
      >
        <IdentifyForm
          answer={answer}
          submitRef={submitRef}
          references={references}
          excluding={null}
          initial={{ identity: null, kind: "person", defaultRole: null, defaultCategoryId: null }}
          toChange={identify}
        />
      </AnswerActions>
      <AnswerPreview answer={answer} applyRef={applyRef} />
    </div>
  );
}
