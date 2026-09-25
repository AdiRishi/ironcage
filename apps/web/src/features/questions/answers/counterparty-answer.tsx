import { type CounterpartyChange, CounterpartyFields } from "@repo/contracts/finance";
import { Struct } from "effect";

import { Accept, AnswerActions, type AnswerProps, AnswerPreview } from "./answer-actions";
import { IdentifyForm } from "./identify-form";
import { useAnswer } from "./use-answer";

// A counterparty the model proposed. Confirming it makes it yours as it is. Something else
// changes what it is, or joins it into a counterparty you already have.
export function CounterpartyAnswer({
  question,
  references,
  onSkip,
  onAnswered,
}: AnswerProps<"counterparty">) {
  const [answer, { acceptRef, submitRef, applyRef }] = useAnswer(onAnswered);
  const { counterparty } = question;
  const update = (fields: typeof CounterpartyFields.Type): CounterpartyChange => ({
    kind: "update",
    counterpartyId: counterparty.id,
    expectedVersion: counterparty.version,
    fields,
  });
  return (
    <div className="space-y-4">
      <AnswerActions
        accept={
          <Accept
            answer={answer}
            acceptRef={acceptRef}
            change={update(Struct.pick(counterparty, Struct.keys(CounterpartyFields.fields)))}
          >
            Confirm {counterparty.name}
          </Accept>
        }
        other="Something else"
        onSkip={onSkip}
        disabled={answer.busy}
      >
        <IdentifyForm
          answer={answer}
          submitRef={submitRef}
          references={references}
          excluding={counterparty.id}
          initial={{
            identity: { kind: "new", name: counterparty.name },
            kind: counterparty.kind,
            defaultRole: counterparty.defaultRole,
            defaultCategoryId: counterparty.defaultCategoryId,
          }}
          toChange={(identified) =>
            identified.kind === "existing"
              ? {
                  kind: "merge",
                  sourceId: counterparty.id,
                  sourceVersion: counterparty.version,
                  targetId: identified.counterparty.id,
                  targetVersion: identified.counterparty.version,
                }
              : update({ ...identified.fields, brand: counterparty.brand })
          }
        />
      </AnswerActions>
      <AnswerPreview answer={answer} applyRef={applyRef} />
    </div>
  );
}
