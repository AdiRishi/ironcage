import { useEffect, useRef } from "react";

// Whether no usable control has focus, as after the one that had it was removed or
// disabled. Chromium keeps a control that was disabled as the active element.
export const focusLost = () => {
  const active = document.activeElement;
  return active === null || active === document.body || active.matches(":disabled");
};

// Focus for a control that is not there yet or is disabled for now, such as the apply
// button of a preview still loading or a field disabled while a change saves. After
// `request`, the first render that finds the element mounted and enabled focuses it.
// With `onlyWhenLost`, that render focuses it only if focus was lost by then, so it
// returns focus a finished action took away and never moves focus you moved yourself.
export function useFocusRequest<Target extends Pick<HTMLElement, "focus" | "matches">>({
  onlyWhenLost = false,
} = {}) {
  const ref = useRef<Target>(null);
  const requested = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!requested.current || !element || element.matches(":disabled")) return;
    requested.current = false;
    if (!onlyWhenLost || focusLost()) element.focus();
  });
  const request = () => {
    requested.current = true;
  };
  return [ref, request] as const;
}
