import { AnswerActions, type AnswerProps, AnswerPreview, type QuestionOf } from "./answer-actions";
import { EventAnswer } from "./event-answer";
import { IdentifyForm, identifyDescriptor } from "./identify-form";
import { useAnswer } from "./use-answer";

// Transactions nothing gives a role. Nothing proposes an answer, so there is no Accept.
// A descriptor is answered by naming who it is, and a transaction without one in the
// correction editor.
export function UnresolvedAnswer({
  question,
  references,
  onSkip,
  onAnswered,
}: AnswerProps<"unresolved">) {
  const { subject } = question;
  if (subject.kind === "event")
    return (
      <EventAnswer
        postingId={subject.postingId}
        references={references}
        other="Say what it is"
        onSkip={onSkip}
        onAnswered={onAnswered}
      />
    );
  return (
    <DescriptorAnswer
      subject={subject}
      references={references}
      onSkip={onSkip}
      onAnswered={onAnswered}
    />
  );
}

function DescriptorAnswer({
  subject,
  references,
  onSkip,
  onAnswered,
}: Omit<AnswerProps<"unresolved">, "question"> & {
  subject: Extract<QuestionOf<"unresolved">["subject"], { kind: "alias" }>;
}) {
  const [answer, { submitRef, applyRef }] = useAnswer(onAnswered);
  return (
    <div className="space-y-4">
      <AnswerActions other="Say who it is" onSkip={onSkip} disabled={answer.busy}>
        <IdentifyForm
          answer={answer}
          submitRef={submitRef}
          references={references}
          excluding={null}
          initial={{ identity: null, kind: "business", defaultRole: null, defaultCategoryId: null }}
          toChange={identifyDescriptor(subject.aliasKey, subject.aliasVersion)}
        />
      </AnswerActions>
      <AnswerPreview answer={answer} applyRef={applyRef} />
    </div>
  );
}
