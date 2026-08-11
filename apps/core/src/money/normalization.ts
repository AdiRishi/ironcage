export const normalizeNarrative = (narrative: string) =>
  narrative.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-AU");

export const narrativeFingerprint = normalizeNarrative;

export const derivedPayee = normalizeNarrative;
