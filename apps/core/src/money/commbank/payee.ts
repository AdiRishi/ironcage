import { commBankAccountProfiles, type CommBankAccountProfileId } from "./profiles";

/**
 * CommBank pads the merchant field of a card narrative to a fixed width and
 * writes the location and any foreign-currency detail after it. Every observed
 * card narrative longer than the field is padded to exactly this column.
 */
const cardMerchantWidth = 25;

const cardSuffix = /\s+Card\s+xx\d{4}(?:\s.*)?$/;
const valueDate = /\s+Value Date:.*$/;

/**
 * Six digits in one token is a bank reference, a payment identifier, or a date:
 * values that change on every occurrence of the same charge. Four is not, so a
 * store number (`WOOLWORTHS 1106`) and a masked account (`xx0001`) survive.
 */
const opaqueReference = (token: string) => (token.match(/\d/g)?.length ?? 0) >= 6;

/**
 * The stable merchant or counterparty behind one narrative, for grouping
 * recurring charges, matching payee rules, and display. It is derived
 * presentation, never evidence: `normalizeNarrative` remains what identity is
 * decided on.
 */
export const commBankPayee = (profileId: CommBankAccountProfileId, narrative: string) => {
  const grammar = commBankAccountProfiles[profileId].narrative;
  const merchant =
    grammar === "card_fixed_width"
      ? narrative.slice(0, cardMerchantWidth)
      : narrative.replace(cardSuffix, "").replace(valueDate, "");

  return merchant
    .normalize("NFKC")
    .split(/\s+/)
    .filter((token) => token !== "" && !opaqueReference(token))
    .join(" ");
};
