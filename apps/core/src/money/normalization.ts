/**
 * The conservative fingerprint the record matches on. It folds presentation
 * differences and nothing else: every digit, reference, and punctuation mark
 * survives, because removing them would let unrelated rows collide.
 *
 * The case fold is locale-independent by chapter 8 §4. A locale-aware fold
 * would let the machine's locale decide whether two stored rows are the same
 * movement.
 */
export const normalizeNarrative = (narrative: string) =>
  narrative.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
