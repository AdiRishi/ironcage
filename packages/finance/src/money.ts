import { FinanceError, type Money } from "@repo/contracts/finance";
import { Effect, Schema } from "effect";

const currencyExponent = (currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency })
    .formatToParts(0n)
    .find((part) => part.type === "fraction")?.value.length ?? 0;

const Decimal = Schema.String.check(Schema.isPattern(/^[+-]?\d+(?:\.\d+)?$/));

export const parseMoney = Effect.fn("parseMoney")(function* (text: string, currency: string) {
  yield* Schema.decodeUnknownEffect(Decimal)(text).pipe(
    Effect.mapError(
      () => new FinanceError({ kind: "invalid", message: "Invalid decimal amount." }),
    ),
  );
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
