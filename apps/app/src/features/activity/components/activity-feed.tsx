import {
  AcknowledgeInput,
  FeedEventView,
  Outcome,
  type FeedEventView as FeedEvent,
} from "@ironcage/contracts/schema";
import { Badge } from "@ironcage/ui/components/badge";
import { Button } from "@ironcage/ui/components/button";
import { Card, CardContent } from "@ironcage/ui/components/card";
import { Input } from "@ironcage/ui/components/input";
import { useQueryClient } from "@tanstack/react-query";
import { Schema } from "effect";
import { useMemo, useState } from "react";

import { keys } from "@/data/keys";
import { mintRequestId } from "@/data/request";
import { formatAgo } from "@/features/money/format";
import { acknowledge } from "@/server/feed";

const encodeAcknowledge = Schema.encodeSync(AcknowledgeInput);
const decodeOutcome = Schema.decodeUnknownSync(Outcome(FeedEventView));

const severityClass = {
  info: "text-muted-foreground",
  notice: "text-primary",
  warning: "text-warning",
  critical: "text-destructive",
} as const;

export function ActivityFeedView({ events }: { readonly events: readonly FeedEvent[] }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<FeedEvent["severity"] | "all">("all");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return events.filter(
      (event) =>
        (severity === "all" || event.severity === severity) &&
        (needle === "" ||
          `${event.summary} ${event.eventType} ${event.origin}`.toLowerCase().includes(needle)),
    );
  }, [events, search, severity]);

  const markRead = async (event: FeedEvent) => {
    const outcome = decodeOutcome(
      await acknowledge({
        data: encodeAcknowledge({ requestId: mintRequestId(), eventId: event.id }),
      }),
    );
    if (outcome.outcome === "ok") {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.feed() }),
        queryClient.invalidateQueries({ queryKey: keys.system() }),
      ]);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search activity"
          className="max-w-sm"
        />
        {(["all", "info", "notice", "warning", "critical"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={severity === value ? "default" : "outline"}
            onClick={() => setSeverity(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No events match this view.
          </p>
        ) : (
          filtered.map((event) => (
            <Card key={event.id} size="sm">
              <CardContent className="flex-row items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={severityClass[event.severity]}>
                      {event.severity}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {event.origin} · {event.eventType} · {formatAgo(event.occurredAt)}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{event.summary}</p>
                </div>
                {event.acknowledgedAt === null ? (
                  <Button size="sm" variant="ghost" onClick={() => void markRead(event)}>
                    Acknowledge
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Acknowledged</span>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
