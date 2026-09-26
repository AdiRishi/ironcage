import type { Conversation, TurnId, TurnStatus } from "@repo/contracts/analyst";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { focusLost } from "@/lib/use-focus-request";

import { Composer } from "./composer";
import { AnalystOff } from "./page";
import { waiting } from "./queries";
import { TurnView } from "./turn";

// A conversation's questions in the order asked, and the next question. When the
// analyst finishes a question you watched it work on, a polite announcement says so, and
// focus moves to the answer unless you have moved it somewhere yourself. The question box
// stays at the bottom of the screen, so the page keeps its height clear when focus
// scrolls something into view.
export function ConversationView({
  conversation,
  enabled,
}: {
  conversation: Conversation;
  // Whether the analyst is on.
  enabled: boolean;
}) {
  const answering = conversation.turns.some((turn) => waiting(turn.status));
  const outcomes = useRef(new Map<TurnId, HTMLElement>());
  const seen = useRef(new Map<TurnId, TurnStatus>());
  // `count` tells one announcement from the next when their words are the same.
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const composer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    const page = document.documentElement;
    // A little more than the box, for the focus ring drawn outside what takes focus.
    const reserve = () => {
      page.style.scrollPaddingBottom = `calc(${element.offsetHeight}px + 0.5rem)`;
    };
    reserve();
    const observer = new ResizeObserver(reserve);
    observer.observe(element);
    return () => {
      observer.disconnect();
      page.style.removeProperty("scroll-padding-bottom");
    };
  }, []);

  useEffect(() => {
    for (const turn of conversation.turns) {
      const before = seen.current.get(turn.id);
      seen.current.set(turn.id, turn.status);
      if (!before || !waiting(before) || waiting(turn.status)) continue;
      setAnnouncement((previous) => ({
        text: turn.status === "answered" ? "Answer ready" : "No answer",
        count: previous.count + 1,
      }));
      // Asking disables the question box, so focus is lost unless you moved it.
      if (focusLost()) outcomes.current.get(turn.id)?.focus();
    }
  }, [conversation]);

  return (
    <div className="space-y-8">
      <Link
        to="/analyst"
        className="inline-flex items-center gap-1 type-small text-slate hover:text-intaglio md:hidden"
      >
        <ChevronLeft aria-hidden className="size-4" />
        All conversations
      </Link>
      <div className="space-y-10">
        {conversation.turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            conversationId={conversation.id}
            answering={answering}
            outcome={(element) => {
              if (element) outcomes.current.set(turn.id, element);
              return () => {
                outcomes.current.delete(turn.id);
              };
            }}
          />
        ))}
      </div>
      <p aria-live="polite" className="sr-only">
        {/* A new node for each announcement, so words said before are said again. */}
        <span key={announcement.count}>{announcement.text}</span>
      </p>
      <div ref={composer} className="sticky bottom-0 border-t border-rule bg-background pt-4 pb-5">
        {enabled ? (
          <Composer
            label="Ask a follow-up question"
            conversationId={conversation.id}
            context={null}
            answering={answering}
          />
        ) : (
          <AnalystOff />
        )}
      </div>
    </div>
  );
}
