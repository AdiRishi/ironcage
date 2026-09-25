import {
  type ListQuestions,
  QuestionFilter,
  type QuestionSummary,
  type ReferenceData,
} from "@repo/contracts/finance";
import { affectedMoney } from "@repo/finance";
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Schema } from "effect";

import { Amount } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { QuestionCard } from "./card";
import { questionsQuery } from "./queries";
import { useQuestionQueue } from "./use-question-queue";

const filterLabels = {
  who: "Who is this",
  people: "People",
  accounts: "Accounts",
  rules: "Rule conflicts",
} satisfies Record<QuestionFilter, string>;
const pressed = "aria-pressed:bg-primary aria-pressed:text-primary-foreground";

// The questions with the most money first, answered in place card by card, then the
// other things that wait on you in `children`.
export function QuestionsPage({
  input,
  summary,
  periodLabel,
  references,
  onFilter,
  children,
}: {
  input: Omit<typeof ListQuestions.Type, "cursor">;
  summary: typeof QuestionSummary.Type;
  // The period the questions are narrowed to, or null for the whole history.
  periodLabel: string | null;
  references: typeof ReferenceData.Type;
  onFilter: (filter: QuestionFilter | null) => void;
  children: React.ReactNode;
}) {
  const list = useSuspenseInfiniteQuery(questionsQuery(input));
  const { ordered, fallback, heading, skip, answered, focus, announcement } = useQuestionQueue(
    list.data.pages.flatMap((page) => page.rows),
  );
  const { filter } = input;
  return (
    <div className="max-w-3xl space-y-10">
      <header className="space-y-2">
        <h1 ref={fallback} tabIndex={-1} className="type-title">
          Questions
        </h1>
        <Overview summary={summary} periodLabel={periodLabel} />
      </header>

      {summary.count > 0 && (
        <ToggleGroup
          aria-label="Kind of question"
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={[filter ?? "all"]}
          onValueChange={([value]) => {
            if (value === undefined) return;
            onFilter(Schema.is(QuestionFilter)(value) ? value : null);
          }}
        >
          <ToggleGroupItem value="all" className={pressed}>
            All <span className="tabular opacity-70">{summary.count}</span>
          </ToggleGroupItem>
          {QuestionFilter.literals.map((item) =>
            summary.byFilter[item] === 0 && item !== filter ? null : (
              <ToggleGroupItem key={item} value={item} className={pressed}>
                {filterLabels[item]}{" "}
                <span className="tabular opacity-70">{summary.byFilter[item]}</span>
              </ToggleGroupItem>
            ),
          )}
        </ToggleGroup>
      )}

      {filter && ordered.length === 0 && (
        <p className="text-slate">No question of this kind is waiting.</p>
      )}
      <ol className="space-y-4">
        {ordered.map((question) => (
          <li key={question.id}>
            <QuestionCard
              question={question}
              references={references}
              periodLabel={periodLabel}
              heading={heading(question.id)}
              onSkip={() => skip(question)}
              onAnswered={() => answered(question)}
            />
          </li>
        ))}
      </ol>
      {list.hasNextPage && (
        <Button
          variant="outline"
          disabled={list.isFetchingNextPage}
          focusableWhenDisabled
          onClick={() => {
            list
              .fetchNextPage()
              .then(({ data }) => {
                const [first] = data?.pages.at(-1)?.rows ?? [];
                if (first) focus(first.id);
              })
              .catch(reportError);
          }}
        >
          More questions
        </Button>
      )}
      <p aria-live="polite" className="sr-only">
        {/* A new node for each announcement, so words said before are said again. */}
        <span key={announcement.count}>{announcement.text}</span>
      </p>

      {children}
    </div>
  );
}

// How many questions there are and the money they affect. Narrowed to a period, only the
// transactions in it count.
function Overview({
  summary,
  periodLabel,
}: {
  summary: typeof QuestionSummary.Type;
  periodLabel: string | null;
}) {
  const everything = periodLabel && (
    <Link
      from="/questions"
      search={(previous) => ({ ...previous, scope: undefined })}
      className="underline underline-offset-4"
    >
      Show every question
    </Link>
  );
  if (summary.count === 0)
    return periodLabel ? (
      <p className="text-slate">
        No question covers a transaction in {periodLabel}. {everything}
      </p>
    ) : (
      <p className="text-slate">Nothing is waiting on you. Every transaction has a meaning.</p>
    );
  return (
    <p className="text-slate">
      {summary.count} {summary.count === 1 ? "question affects" : "questions affect"}{" "}
      <Amount value={affectedMoney(summary)} cents={false} className="text-intaglio" />
      {periodLabel ? ` in ${periodLabel}` : " across your history"}. Each answer applies to every
      transaction it covers, past and future. {everything}
    </p>
  );
}
