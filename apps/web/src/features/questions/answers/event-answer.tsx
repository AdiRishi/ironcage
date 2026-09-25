import type { PostingId, ReferenceData } from "@repo/contracts/finance";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { EventEditor } from "@/features/events/editor";
import { eventForPostingQuery } from "@/features/events/queries";
import { useFocusRequest } from "@/lib/use-focus-request";

import { AnswerActions } from "./answer-actions";

// A question about one transaction, answered with the correction editor in the card: it
// previews the correction and saves it on that transaction. Closing the editor removes
// the control that had focus, so focus returns to the button that opened it.
export function EventAnswer({
  postingId,
  references,
  other,
  onSkip,
  onAnswered,
}: {
  postingId: typeof PostingId.Type;
  references: typeof ReferenceData.Type;
  other: string;
  onSkip: () => void;
  onAnswered: () => void;
}) {
  const [open, setOpen] = useState(false);
  // From the save until the questions refresh.
  const [saving, setSaving] = useState(false);
  const [otherRef, requestOther] = useFocusRequest<HTMLButtonElement>();
  return (
    <AnswerActions
      other={other}
      otherRef={otherRef}
      open={open}
      onOpenChange={setOpen}
      onSkip={onSkip}
      disabled={saving}
    >
      <TransactionEditor
        postingId={postingId}
        references={references}
        onApplied={() => {
          setSaving(true);
          onAnswered();
        }}
        onClose={() => {
          requestOther();
          setSaving(false);
          setOpen(false);
        }}
      />
    </AnswerActions>
  );
}

function TransactionEditor({
  postingId,
  references,
  onApplied,
  onClose,
}: {
  postingId: typeof PostingId.Type;
  references: typeof ReferenceData.Type;
  onApplied: () => void;
  onClose: () => void;
}) {
  const event = useQuery(eventForPostingQuery(postingId));
  if (event.error) return <p role="alert">{event.error.message}</p>;
  if (!event.data) return <p className="text-slate">Loading the transaction…</p>;
  return (
    <EventEditor
      event={event.data}
      references={references}
      onApplied={onApplied}
      onClose={onClose}
    />
  );
}
