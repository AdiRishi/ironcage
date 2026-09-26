import type { AskContext, Conversation, ConversationId } from "@repo/contracts/analyst";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import { useId } from "react";

import { Composer } from "./composer";
import { ConversationList } from "./conversation-list";

// The conversations beside the open one or a new question. On a phone the list and a new
// question are one page, and a conversation is another with a link back.
export function AnalystPage({
  open,
  children,
}: {
  open: ConversationId | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <h1 className="type-title">Analyst</h1>
      <div className="grid gap-x-8 gap-y-10 md:grid-cols-12">
        <div className="min-w-0 md:col-span-8 md:col-start-5 md:row-start-1">{children}</div>
        <div className={cn("md:col-span-4 md:col-start-1 md:row-start-1", open && "max-md:hidden")}>
          <ConversationList open={open} />
        </div>
      </div>
    </div>
  );
}

const examples = [
  "Why was August more expensive than July?",
  "How much did the Japan trip cost, including the flights booked in March?",
  "What subscriptions do I pay for, and which ones started this year?",
];

// A question that starts a conversation, about the selection it was asked from, if any.
// Before the first question, the screen says what the analyst does and offers examples.
export function NewQuestion({
  context,
  enabled,
  first,
  onRemoveContext,
  onAsked,
}: {
  context: AskContext | null;
  // Whether the analyst is on.
  enabled: boolean;
  first: boolean;
  onRemoveContext: () => void;
  onAsked: (conversation: Conversation) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-4">
      <h2 id={`${id}-heading`} className="type-heading">
        New question
      </h2>
      {first && (
        <p className="max-w-prose">
          Ask about your money in plain language. Every figure in an answer links to its records.
        </p>
      )}
      {enabled ? (
        <Composer
          label="Your question"
          conversationId={null}
          context={context}
          onRemoveContext={onRemoveContext}
          onAsked={onAsked}
          answering={false}
          examples={first ? examples : []}
        />
      ) : (
        <AnalystOff />
      )}
    </section>
  );
}

export function AnalystOff() {
  return (
    <p className="max-w-prose">
      The analyst is off. It sends the model the figures and bank descriptions that answer each
      question. Turn it on in{" "}
      <Link to="/settings" className="underline underline-offset-4">
        Settings
      </Link>
      .
    </p>
  );
}
