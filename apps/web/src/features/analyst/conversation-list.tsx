import type { ConversationId } from "@repo/contracts/analyst";
import { useSuspenseInfiniteQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { Button } from "@/components/ui/button";
import { settingsQueryOptions } from "@/features/settings/queries";
import { instantLabel } from "@/lib/time";

import { conversationsQuery } from "./queries";

// Conversations, most recently asked first, each titled by its first question. The open
// one is marked with an Intaglio rule, as the top bar marks the open screen. With one
// open, New question leads back to an empty question box.
export function ConversationList({ open }: { open: ConversationId | null }) {
  const id = useId();
  const list = useSuspenseInfiniteQuery(conversationsQuery());
  const { data: settings } = useSuspenseQuery(settingsQueryOptions());
  const rows = list.data.pages.flatMap((page) => page.rows);
  return (
    <nav aria-labelledby={`${id}-heading`} className="space-y-4">
      {open && (
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to="/analyst" activeOptions={{ exact: true }} />}
        >
          New question
        </Button>
      )}
      <h2 id={`${id}-heading`} className="type-heading">
        Conversations
      </h2>
      {rows.length === 0 ? (
        <p className="type-small text-slate">Your questions and their answers stay here.</p>
      ) : (
        <ul className="-mx-2 space-y-1">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to="/analyst/$conversationId"
                params={{ conversationId: row.id }}
                className="block rounded-r-md border-l-2 py-1.5 pr-2 pl-1.5 hover:bg-sheet"
                activeProps={{ className: "border-intaglio font-[560]" }}
                inactiveProps={{ className: "border-transparent" }}
              >
                <span className="line-clamp-2">{row.title}</span>
                <span className="block type-small text-slate">
                  {row.answering ? "Answering…" : instantLabel(row.updatedAt, settings.timezone)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="outline"
          size="sm"
          disabled={list.isFetchingNextPage}
          focusableWhenDisabled
          onClick={() => {
            list.fetchNextPage().catch(reportError);
          }}
        >
          Older conversations
        </Button>
      )}
    </nav>
  );
}
