import type { Question, QuestionReach, ReferenceData, RoleBasis } from "@repo/contracts/finance";
import { Link } from "@tanstack/react-router";
import { type Ref, useId } from "react";

import { Amount } from "@/components/amount";
import { kindLabels } from "@/features/counterparties/choices";

import { AliasAnswer } from "./answers/alias-answer";
import { CounterpartyAnswer } from "./answers/counterparty-answer";
import { OwnAccountAnswer } from "./answers/own-account-answer";
import { PersonAnswer } from "./answers/person-answer";
import { RuleConflictAnswer } from "./answers/rule-conflict-answer";
import { UnresolvedAnswer } from "./answers/unresolved-answer";
import {
  accountName,
  affectedDates,
  categoryName,
  modelText,
  questionTitle,
  roleText,
} from "./describe";

type References = typeof ReferenceData.Type;

// One question: what it asks, what it affects, why Ironcage thinks what it does, a few of
// its transactions, and the answers. `heading` registers the heading that takes focus
// when this card comes next.
export function QuestionCard({
  question,
  references,
  periodLabel: narrowedTo,
  heading,
  onSkip,
  onAnswered,
}: {
  question: Question;
  references: References;
  // The period the list is narrowed to, if any.
  periodLabel: string | null;
  heading: Ref<HTMLHeadingElement>;
  onSkip: () => void;
  onAnswered: () => void;
}) {
  const id = useId();
  const { affects, affectsInPeriod } = question;
  return (
    <article
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-lg border border-rule bg-sheet p-5"
    >
      <header className="space-y-1">
        <h2 ref={heading} id={`${id}-title`} tabIndex={-1} className="type-heading">
          {questionTitle(question)}
        </h2>
        <p className="type-small text-slate">
          {transactions(affects.eventCount)}, {affectedDates(question)}: <Moved reach={affects} />.
        </p>
        {affectsInPeriod && narrowedTo && (
          <p className="type-small text-slate">
            {affectsInPeriod.eventCount} of them in {narrowedTo}: <Moved reach={affectsInPeriod} />.
          </p>
        )}
      </header>
      <Why question={question} references={references} />
      <Samples question={question} />
      <AnswerFor
        question={question}
        references={references}
        onSkip={onSkip}
        onAnswered={onAnswered}
      />
    </article>
  );
}

const transactions = (count: number) => `${count} ${count === 1 ? "transaction" : "transactions"}`;

function Moved({ reach }: { reach: typeof QuestionReach.Type }) {
  const out = reach.outflow.minor > 0n && (
    <>
      <Amount value={reach.outflow} cents={false} /> out
    </>
  );
  const into = reach.inflow.minor > 0n && (
    <>
      <Amount value={reach.inflow} cents={false} /> in
    </>
  );
  return out && into ? (
    <>
      {out} and {into}
    </>
  ) : (
    out || into || "no money moved"
  );
}

// What Ironcage proposes, and why.
function Why({ question, references }: { question: Question; references: References }) {
  const lines = reasons(question, references);
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

function reasons(question: Question, references: References): readonly string[] {
  switch (question.kind) {
    case "counterparty": {
      const { counterparty } = question;
      const usual = counterparty.defaultCategoryId
        ? `, usually ${categoryName(references.categories, counterparty.defaultCategoryId)}`
        : "";
      return [
        `Proposed: ${counterparty.name}, ${kindLabels[counterparty.kind].toLowerCase()}${usual}.`,
        modelText(question.basis),
      ];
    }
    case "alias":
      return [`Proposed: ${question.counterparty.name}.`, modelText(question.basis)];
    case "person":
      return question.proposal
        ? [
            `Proposed: ${roleText(question.proposal.role, question.proposal.categoryId, references.categories)}.`,
            basisText(question.proposal.basis),
          ]
        : ["Nothing suggests what these payments are yet."];
    case "ownAccount":
      return [
        `Money moved with the ${accountName(question.aliasKey).toLowerCase()}, which is none of your accounts in Ironcage. Proposed: your own account elsewhere.`,
      ];
    case "unresolved":
      return question.subject.kind === "alias"
        ? ["Nothing says who this is or what the money was for."]
        : ["The bank printed no name, so nothing says what this was."];
    case "ruleConflict":
      return [];
  }
}

function basisText(basis: typeof RoleBasis.Type) {
  switch (basis.kind) {
    case "answer":
      return `You said the same about ${basis.counterpartyName}'s payments with this reference.`;
    case "reference":
      return "The reference names one of your categories.";
    case "model":
      return modelText(basis);
  }
}

function Samples({ question }: { question: Question }) {
  const { eventCount } = question.affects;
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-rule/70 border-y border-rule/70 type-small">
        {question.samples.map((sample) => (
          <li key={sample.eventId}>
            <Link
              to="/ledger/$id"
              params={{ id: sample.postingId }}
              className="grid grid-cols-[5.5rem_1fr_auto] gap-3 py-1.5 hover:text-intaglio"
            >
              <span className="text-slate tabular">{sample.postedOn}</span>
              <span className="truncate">{sample.description}</span>
              <Amount value={sample.amount} />
            </Link>
          </li>
        ))}
      </ul>
      {eventCount > question.samples.length && (
        <Link
          to="/ledger"
          search={{ questionId: question.id }}
          className="type-small underline underline-offset-4"
        >
          See all {eventCount}
        </Link>
      )}
    </div>
  );
}

// The answers each kind of question takes.
function AnswerFor({
  question,
  references,
  onSkip,
  onAnswered,
}: {
  question: Question;
  references: References;
  onSkip: () => void;
  onAnswered: () => void;
}) {
  const actions = { references, onSkip, onAnswered };
  switch (question.kind) {
    case "counterparty":
      return <CounterpartyAnswer question={question} {...actions} />;
    case "alias":
      return <AliasAnswer question={question} {...actions} />;
    case "person":
      return <PersonAnswer question={question} {...actions} />;
    case "ownAccount":
      return <OwnAccountAnswer question={question} {...actions} />;
    case "unresolved":
      return <UnresolvedAnswer question={question} {...actions} />;
    case "ruleConflict":
      return <RuleConflictAnswer question={question} {...actions} />;
  }
}
