import type { CounterpartyChange } from "@repo/contracts/finance";
import { useState } from "react";

import { useCounterpartyChange } from "@/features/counterparties/use-counterparty-change";
import { useFocusRequest } from "@/lib/use-focus-request";

// An answer that changes a counterparty, a descriptor, or a reference default. Accept and
// an answer of your own both preview what they change, and Apply saves the change with
// the versions the preview read. `onAnswered` runs once it is saved, before the questions
// refresh. Focus moves to Apply when a preview arrives, and back to whichever control
// asked for it when you cancel, because both are disabled or gone in between.
export function useAnswer(onAnswered: () => void) {
  const change = useCounterpartyChange(onAnswered);
  const [acceptRef, requestAccept] = useFocusRequest<HTMLButtonElement>();
  const [submitRef, requestSubmit] = useFocusRequest<HTMLButtonElement>();
  const [applyRef, requestApply] = useFocusRequest<HTMLButtonElement>();
  const [origin, setOrigin] = useState<"accept" | "submit">("accept");
  const preview = (from: typeof origin, next: CounterpartyChange) => {
    setOrigin(from);
    requestApply();
    change.preview(next);
  };
  const answer = {
    change,
    busy: change.pending || change.uncertain,
    accept: (next: CounterpartyChange) => preview("accept", next),
    submit: (next: CounterpartyChange) => preview("submit", next),
    cancel: () => {
      if (origin === "accept") requestAccept();
      else requestSubmit();
      change.reset();
    },
  };
  // The buttons that take focus: Accept, the answer form's submit button, and Apply.
  return [answer, { acceptRef, submitRef, applyRef }] as const;
}
export type Answer = ReturnType<typeof useAnswer>[0];
export type FocusRef = ReturnType<typeof useFocusRequest<HTMLButtonElement>>[0];
