import { financialRoleLabels } from "@repo/finance";

import { categoryName } from "../describe";
import type { AnswerProps } from "./answer-actions";
import { EventAnswer } from "./event-answer";

// Rules that match one transaction and disagree. You choose on the transaction, and the
// choice is a correction, which outranks every rule.
export function RuleConflictAnswer({
  question,
  references,
  onSkip,
  onAnswered,
}: AnswerProps<"ruleConflict">) {
  return (
    <div className="space-y-4">
      <ul className="space-y-1">
        {question.rules.map((rule) => (
          <li key={rule.id}>
            <span className="font-[560]">{rule.name}</span> sets{" "}
            {rule.action.kind === "role"
              ? `the role to ${financialRoleLabels[rule.action.role].toLowerCase()}`
              : `the category to ${categoryName(references.categories, rule.action.categoryId)}`}
          </li>
        ))}
      </ul>
      <EventAnswer
        postingId={question.postingId}
        references={references}
        other="Choose on this transaction"
        onSkip={onSkip}
        onAnswered={onAnswered}
      />
    </div>
  );
}
