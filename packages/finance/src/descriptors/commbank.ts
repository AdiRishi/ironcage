import type { AccountKind, Channel, Descriptor } from "@repo/contracts/finance";

export const commbankProfileVersion = 1;

const countryCodes = new Set([
  "AU",
  "AUS",
  "CA",
  "CH",
  "DE",
  "FR",
  "GB",
  "HK",
  "IE",
  "JP",
  "LU",
  "NL",
  "NZ",
  "SE",
  "SG",
  "UK",
  "US",
  "USA",
]);

export function aliasKey(text: string): string | null {
  const words = text
    .toUpperCase()
    .replace(/[^A-Z0-9&'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !/\d/.test(word));
  if (words.length > 1 && countryCodes.has(words.at(-1) ?? "")) words.pop();
  return words.length > 0 ? words.join(" ") : null;
}

const channelWord = String.raw`(?:CommBank app|CommBank|NetBank)`;
const ownTransfer = new RegExp(
  String.raw`^Transfer (?:to|from) xx(\d{4})(?:\s+${channelWord})?(?:\s+(.*))?$`,
  "i",
);
const payIdTransfer = new RegExp(
  String.raw`^Transfer to (.+?) PayID (\S+) from ${channelWord}(?:\s+(.*))?$`,
  "i",
);
const namedTransfer = new RegExp(
  String.raw`^(?:Fast )?Transfer (?:to|from) (.+?) ${channelWord}(?:\s+(.*))?$`,
  "i",
);
const bareTransferFrom = /^(?:Fast )?Transfer from (.+)$/i;
const cardMarker = /^(.*?)\s+(?:Card\s+)?xx(\d{4})(?:\s+([A-Z]{3})\s+([\d,]*\d\.\d{2}))?\s*$/;
const foreignAmount = /\s+([A-Z]{3})\s+([\d,]*\d\.\d{2})\b/;

function text(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Splits "ACME PTY LTD HR123456" into the name before the first token that
// carries a digit and the reference that follows it.
function splitAtReference(value: string) {
  const words = value.trim().split(/\s+/);
  const index = words.findIndex((word) => /\d/.test(word));
  return index === -1
    ? { name: text(value), reference: null }
    : {
        name: text(words.slice(0, index).join(" ")),
        reference: text(words.slice(index).join(" ")),
      };
}

// Names in bank transfers are capitalised; the free-text reference after them
// usually starts in lower case.
function splitName(value: string) {
  const words = value.trim().split(/\s+/);
  let end = 0;
  while (end < words.length && end < 4 && /^[A-Z]/.test(words[end] ?? "")) end += 1;
  return end === 0
    ? { name: text(value), reference: null }
    : { name: text(words.slice(0, end).join(" ")), reference: text(words.slice(end).join(" ")) };
}

export function describeCommBank({
  description,
  amountMinor,
  accountKind,
}: {
  description: string;
  amountMinor: bigint;
  accountKind: typeof AccountKind.Type;
}): Descriptor {
  const value = description.replace(/\s+Value Date:\s*\d{2}\/\d{2}\/\d{4}$/, "").trim();
  const credit = amountMinor > 0n;
  const make = (
    channel: Channel,
    fields: Partial<Omit<Descriptor, "channel" | "profileVersion" | "aliasKey">> = {},
  ): Descriptor => {
    const counterpartyText = fields.counterpartyText ?? null;
    const ownAccountSuffix = fields.ownAccountSuffix ?? null;
    return {
      profileVersion: commbankProfileVersion,
      channel,
      counterpartyText,
      // An own-account suffix that matches none of your accounts still needs an
      // answer, so it gets an alias of its own.
      aliasKey: counterpartyText
        ? aliasKey(counterpartyText)
        : ownAccountSuffix
          ? `ACCOUNT ${ownAccountSuffix}`
          : null,
      cardSuffix: fields.cardSuffix ?? null,
      ownAccountSuffix,
      payId: fields.payId ?? null,
      reference: fields.reference ?? null,
      foreign: fields.foreign ?? null,
    };
  };
  const card = cardMarker.exec(value);

  if (/^International Transaction Fee\b/i.test(value)) return make("fee");
  if (!card && /\bFees?\b/i.test(value) && !credit) return make("fee");
  if (/^(?:Credit |Bonus )?Interest\b/i.test(value)) return make("interest");
  if (
    (accountKind === "loan" && /Repayment\/Payment|Money we lent you/i.test(value)) ||
    /^Loan\b/i.test(value)
  )
    return make("loan", { reference: text(value.replace(/^Loan\s+/i, "")) });

  const own = ownTransfer.exec(value);
  if (own) return make("transfer", { ownAccountSuffix: own[1] ?? null, reference: text(own[2]) });
  const payId = payIdTransfer.exec(value);
  if (payId)
    return make("transfer", {
      counterpartyText: text(payId[1]),
      payId: text(payId[2]),
      reference: text(payId[3]),
    });
  const named = namedTransfer.exec(value);
  if (named)
    return make("transfer", { counterpartyText: text(named[1]), reference: text(named[2]) });
  const bareFrom = bareTransferFrom.exec(value);
  if (bareFrom) {
    const { name, reference } = splitName(bareFrom[1] ?? "");
    return make("transfer", { counterpartyText: name, reference });
  }

  const direct = /^Direct (Debit|Credit)\s+\d+\s+(.+)$/i.exec(value);
  if (direct) {
    const { name, reference } = splitAtReference(direct[2] ?? "");
    return make(direct[1]?.toLowerCase() === "debit" ? "directDebit" : "directCredit", {
      counterpartyText: name,
      reference,
    });
  }
  const salary = /^Salary\s+(.+)$/i.exec(value);
  if (salary) {
    const { name, reference } = splitAtReference(
      (salary[1] ?? "").replace(/\s+Salary$/i, "").trim(),
    );
    return make("salary", { counterpartyText: name, reference });
  }
  if (/^(?:Wdl ATM|ATM|Cash Out)\b/i.test(value)) return make("cash");
  const bpay = /^BPAY\s+(.+)$/i.exec(value);
  if (bpay) {
    const { name, reference } = splitAtReference(bpay[1] ?? "");
    return make("bpay", { counterpartyText: name, reference });
  }

  if (accountKind === "card" && credit && /^Payment\b|PAYMENT.*THANK/i.test(value))
    return make("cardPayment");

  const refund = /^(?:Refund Purchase|Return)\s+(.+)$/i.exec(value);
  const purchase = refund?.[1] ?? value;
  const marked = cardMarker.exec(purchase);
  if (marked)
    return make("card", {
      counterpartyText: text(marked[1]),
      cardSuffix: marked[2] ?? null,
      foreign:
        marked[3] && marked[4]
          ? { currency: marked[3], amount: marked[4].replaceAll(",", "") }
          : null,
    });
  const foreign = foreignAmount.exec(purchase);
  const fields = {
    counterpartyText: text(foreign ? purchase.slice(0, foreign.index) : purchase),
    foreign:
      foreign?.[1] && foreign[2]
        ? { currency: foreign[1], amount: foreign[2].replaceAll(",", "") }
        : null,
  };
  if (refund || accountKind === "card") return make("card", fields);
  return make("other", fields);
}
