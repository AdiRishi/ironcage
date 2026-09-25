import { useEffect, useRef } from "react";

// Focus for a control that is not there yet or is disabled for now, such as the apply
// button of a preview still loading or a field disabled while a change saves. After
// `request`, the first render that finds the element mounted and enabled focuses it.
export function useFocusRequest<Target extends Pick<HTMLElement, "focus" | "matches">>() {
  const ref = useRef<Target>(null);
  const requested = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!requested.current || !element || element.matches(":disabled")) return;
    requested.current = false;
    element.focus();
  });
  const request = () => {
    requested.current = true;
  };
  return [ref, request] as const;
}
