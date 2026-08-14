/**
 * Version 1 of the narrative normalizer. Any change to these rules — a new
 * suffix, a different token filter — is a new version and a reprocessing run,
 * because stored matching fields carry the version that derived them.
 */
export const normalizerVersion = 1;

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** NFKC, whitespace collapse, and trim; the source cell is never rewritten. */
export const displayNarrative = (narrative: string): string =>
  collapse(narrative.normalize("NFKC"));

/**
 * The identity-grade matching text. It deliberately keeps every digit and
 * punctuation mark — reference numbers and value dates make unrelated rows
 * less likely to collide, so removing them would weaken tier 3.
 */
export const narrativeFingerprint = (narrative: string): string =>
  displayNarrative(narrative).toLowerCase();

export type PayeeGrammar = "card" | "deposit";

/** The observed Mastercard merchant field is the first 25 characters. */
const cardMerchantWidth = 25;

const depositSuffixes = [/ Card xx\d+.*$/i, / Value Date:.*$/i];

const dropReferenceTokens = (text: string) =>
  text
    .split(" ")
    .filter((token) => (token.match(/\d/g)?.length ?? 0) < 6)
    .join(" ");

/**
 * Who was paid, for grouping and display — never transaction identity. The
 * card grammar takes the fixed-width merchant column; the deposit grammar
 * cuts the known card and value-date suffixes. Both then drop
 * whitespace-delimited tokens carrying six or more digits, which removes bank
 * references without erasing shorter digits that belong to a payee's name.
 */
export const derivePayee = (narrative: string, grammar: PayeeGrammar): string => {
  const base =
    grammar === "card"
      ? narrative.slice(0, cardMerchantWidth)
      : depositSuffixes.reduce((text, suffix) => text.replace(suffix, ""), narrative);

  const payee = collapse(dropReferenceTokens(collapse(base.normalize("NFKC"))));

  return payee === "" ? displayNarrative(narrative) : payee;
};
