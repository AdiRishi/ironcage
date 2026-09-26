import type { Briefing, BriefingSections } from "@repo/contracts/analyst";
import type { YearMonth } from "@repo/contracts/finance";
import { monthLabel, shiftYearMonth } from "@repo/finance";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Struct } from "effect";
import { useEffect, useId, useRef } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { modelSettingsQuery } from "@/features/models/queries";
import { useAnnouncement } from "@/lib/use-announcement";
import { useFocusRequest } from "@/lib/use-focus-request";

import { AnswerText, citationsOf } from "./answer-text";
import { AskAbout } from "./ask-about";
import { BasisLine, Limits } from "./basis";
import { requestBriefing } from "./functions";
import { briefingQuery, briefingsQuery } from "./queries";

// The id of the overview's briefing section, which the analyst screen's briefings open.
export const briefingAnchor = "briefing";

// The sections in the order they show.
const headings = (month: YearMonth) =>
  ({
    cameIn: "What came in",
    wentOut: "What went out",
    changed: `What changed from ${monthLabel(shiftYearMonth(month, -1))}`,
    needsAnswer: "What needs an answer",
  }) satisfies Record<keyof BriefingSections, string>;

// The analyst's briefing of a month that has ended, while the analyst is on. The overview
// keeps its components when the period changes, so the key gives each month a section of
// its own, and nothing announced, asked for, or refused for one month shows for another.
export function BriefingSection({ month }: { month: YearMonth }) {
  const { data: models } = useSuspenseQuery(modelSettingsQuery());
  return models.analyst.enabled ? <MonthBriefing key={month} month={month} /> : null;
}

// The briefing loads after the page, so the overview never waits for it. Asking for a
// write takes its button away, so focus moves to the line that says the analyst is
// writing, and a polite announcement says how a write you watched ended.
function MonthBriefing({ month }: { month: YearMonth }) {
  const id = useId();
  const briefing = useQuery(briefingQuery(month));
  const [content, focusContent] = useFocusRequest<HTMLDivElement>({ onlyWhenLost: true });
  const [announcer, announce] = useAnnouncement();
  const status = briefing.data?.status;
  const seen = useRef(status);
  useEffect(() => {
    if (seen.current === "writing") {
      if (status === "ready") announce("Briefing ready");
      if (status === "failed" || status === "blocked")
        announce("The briefing could not be written");
    }
    seen.current = status;
  }, [status, announce]);
  return (
    <section id={briefingAnchor} aria-labelledby={`${id}-heading`} className="space-y-4">
      <h2 id={`${id}-heading`} className="type-heading">
        The analyst's briefing
      </h2>
      <div ref={content} tabIndex={-1} className="rounded-sm">
        {briefing.data ? (
          <BriefingBody briefing={briefing.data} onRequested={focusContent} />
        ) : briefing.error ? (
          <p role="alert">
            {briefing.error.message}{" "}
            <Button
              variant="link"
              onClick={() => {
                briefing.refetch().catch(reportError);
              }}
            >
              Retry
            </Button>
          </p>
        ) : (
          <output className="type-small text-slate">Reading the briefing…</output>
        )}
      </div>
      {announcer}
    </section>
  );
}

function BriefingBody({ briefing, onRequested }: { briefing: Briefing; onRequested: () => void }) {
  const month = monthLabel(briefing.month);
  switch (briefing.status) {
    case "ready":
      return <Written briefing={briefing} />;
    case "writing":
      return (
        <p className="text-slate">
          The analyst is writing {month}'s briefing from your latest records.
        </p>
      );
    case "none":
      return (
        <div className="space-y-3">
          <p className="text-slate">The analyst has not written a briefing of {month}.</p>
          <Write month={briefing.month} label="Write the briefing" onRequested={onRequested} />
        </div>
      );
    case "failed":
      return (
        <div className="space-y-3">
          <p>{briefing.message}</p>
          <Write month={briefing.month} label="Write it again" onRequested={onRequested} />
        </div>
      );
    case "blocked":
      return (
        <div className="space-y-1">
          <p>{briefing.message}</p>
          <p>
            <Link to="/settings" className="underline underline-offset-4">
              Open Settings
            </Link>
          </p>
        </div>
      );
  }
}

// The four sections with their figures linked to the records behind them, then what the
// figures rest on and where they fall short.
function Written({ briefing }: { briefing: Extract<Briefing, { status: "ready" }> }) {
  const cited = citationsOf(briefing);
  const titles = headings(briefing.month);
  return (
    <div className="space-y-6">
      <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
        {Struct.keys(titles).map((key) => (
          <div key={key} className="max-w-prose space-y-1.5">
            <h3 className="type-small font-[560]">{titles[key]}</h3>
            <div className="space-y-2">
              <AnswerText text={briefing.sections[key]} cited={cited} />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {briefing.basis && <BasisLine basis={briefing.basis} />}
        <Limits limits={briefing.limits} cited={cited} />
      </div>
      <AskAbout about={{ kind: "briefing", month: briefing.month }}>
        Ask about this briefing
      </AskAbout>
    </div>
  );
}

// Asks the analyst to write the month's briefing. A write that could not be asked for
// keeps focus on the button and says why, such as a facts rebuild still running.
function Write({
  month,
  label,
  onRequested,
}: {
  month: YearMonth;
  label: string;
  onRequested: () => void;
}) {
  const client = useQueryClient();
  const request = useMutation({
    mutationFn: () => requestBriefing({ data: { month } }),
    onSuccess: async (briefing) => {
      onRequested();
      client.setQueryData(briefingQuery(month).queryKey, briefing);
      await client.invalidateQueries({ queryKey: briefingsQuery().queryKey });
    },
  });
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={request.isPending}
        focusableWhenDisabled
        onClick={() => request.mutate()}
      >
        {request.isPending ? "Asking…" : label}
      </Button>
      {request.error && (
        <Alert variant="destructive">
          <AlertDescription>{request.error.message}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
