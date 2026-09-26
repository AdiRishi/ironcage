import type { Question, QuestionId } from "@repo/contracts/finance";
import { useEffect, useRef, useState } from "react";

import { useAnnouncement } from "@/lib/use-announcement";

import { questionTitle } from "./describe";

// The order you work through questions in, and where focus goes as you do. Skip moves a
// question to the end for this visit and stores nothing, so every count still includes
// it. One answer can close several questions, or none, and only the server groups them,
// so focus moves on once the refreshed list no longer has the question answered.
export function useQuestionQueue(rows: readonly Question[]) {
  const [skipped, setSkipped] = useState<readonly QuestionId[]>([]);
  const [announcer, announce] = useAnnouncement();
  const headings = useRef(new Map<QuestionId, HTMLElement>());
  // Takes focus when no question is left.
  const fallback = useRef<HTMLHeadingElement>(null);
  const focusing = useRef<QuestionId | "fallback" | null>(null);
  // The question answered, with the questions that followed it, nearest first.
  const answering = useRef<{ id: QuestionId; next: readonly QuestionId[] } | null>(null);
  const ordered = [
    ...rows.filter((row) => !skipped.includes(row.id)),
    ...skipped.flatMap((id) => rows.filter((row) => row.id === id)),
  ];
  const present = (id: QuestionId) => ordered.some((row) => row.id === id);
  // The questions after `id` in the order you see them, then those before it.
  const following = (id: QuestionId) => {
    const at = ordered.findIndex((row) => row.id === id);
    return [...ordered.slice(at + 1), ...ordered.slice(0, at).toReversed()].map((row) => row.id);
  };

  useEffect(() => {
    const answered = answering.current;
    if (answered && !present(answered.id)) {
      answering.current = null;
      focusing.current = answered.next.find(present) ?? "fallback";
    }
    const target = focusing.current;
    if (target === null) return;
    focusing.current = null;
    (target === "fallback" ? fallback.current : headings.current.get(target))?.focus();
  });

  return {
    ordered,
    fallback,
    // Registers a card's heading, which takes focus when its card comes next.
    heading: (id: QuestionId) => (element: HTMLElement | null) => {
      if (element) headings.current.set(id, element);
      return () => {
        headings.current.delete(id);
      };
    },
    skip: (question: Question) => {
      focusing.current = following(question.id)[0] ?? question.id;
      announce(`Skipped: ${questionTitle(question)}`);
      setSkipped((previous) => [...previous.filter((id) => id !== question.id), question.id]);
    },
    // Called once an answer is saved, before the list refreshes.
    answered: (question: Question) => {
      answering.current = { id: question.id, next: following(question.id) };
      announce(`Answered: ${questionTitle(question)}`);
    },
    // Focuses a question's heading, now if its card is shown or once it is.
    focus: (id: QuestionId) => {
      const heading = headings.current.get(id);
      if (heading) heading.focus();
      else focusing.current = id;
    },
    // The live region that says which question you skipped or answered.
    announcer,
  };
}
