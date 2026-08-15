export const visibleSafetyPoll = () =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? 60_000 : false;
