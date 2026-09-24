import { FinanceError, type Money } from "@repo/contracts/finance";
import { Effect } from "effect";

const exponents = new Map<string, number>();
export const currencyExponent = (currency: string) => {
  let exponent = exponents.get(currency);
  if (exponent === undefined) {
    exponent =
      new Intl.NumberFormat("en", { style: "currency", currency })
        .formatToParts(0n)
        .find((part) => part.type === "fraction")?.value.length ?? 0;
    exponents.set(currency, exponent);
  }
  return exponent;
};

export const parseMoney = Effect.fnUntraced(function* (text: string, currency: string) {
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(text))
    return yield* new FinanceError({ kind: "invalid", message: "Invalid decimal amount." });
  const exponent = currencyExponent(currency);
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [whole = "0", fraction = ""] = unsigned.split(".");
  if (fraction.length > exponent)
    return yield* new FinanceError({
      kind: "invalid",
      message: "Amount has too many decimal places.",
    });
  const minor = BigInt(whole + fraction.padEnd(exponent, "0")) * (negative ? -1n : 1n);
  return { currency, minor } satisfies Money;
});

export function formatMoney({ minor, currency }: Money) {
  const exponent = currencyExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const absolute = minor < 0n ? -minor : minor;
  const whole = new Intl.NumberFormat("en-AU", { maximumFractionDigits: 0 }).format(
    absolute / scale,
  );
  const fraction =
    exponent === 0 ? "" : `.${(absolute % scale).toString().padStart(exponent, "0")}`;
  return `${minor < 0n ? "−" : ""}${whole}${fraction} ${currency}`;
}

export function formatDecimal({ minor, currency }: Money) {
  const exponent = currencyExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const absolute = minor < 0n ? -minor : minor;
  return `${minor < 0n ? "-" : ""}${absolute / scale}${exponent === 0 ? "" : `.${(absolute % scale).toString().padStart(exponent, "0")}`}`;
}

// "$6,380" or "$6,380.45", with a real minus sign. Whole amounts round half up.
export function formatCurrency({ minor, currency }: Money, { cents = true } = {}) {
  const exponent = currencyExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const absolute = minor < 0n ? -minor : minor;
  const whole = cents ? absolute / scale : (absolute + scale / 2n) / scale;
  const symbol = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(whole);
  const fraction =
    cents && exponent > 0 ? `.${(absolute % scale).toString().padStart(exponent, "0")}` : "";
  return `${minor < 0n ? "−" : ""}${symbol}${fraction}`;
}
