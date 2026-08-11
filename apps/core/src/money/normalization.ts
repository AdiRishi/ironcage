/**
 * The conservative fingerprint the record matches on. It folds presentation
 * differences and nothing else: every digit, reference, and punctuation mark
 * survives, because removing them would let unrelated rows collide.
 */
export const normalizeNarrative = (narrative: string) =>
  narrative.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-AU");
