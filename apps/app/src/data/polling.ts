export const visibleSafetyPoll = () =>
  globalThis.document?.visibilityState === "visible" ? 60_000 : false;
