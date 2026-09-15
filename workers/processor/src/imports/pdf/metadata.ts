import { type BankAccount, type Statement } from "@repo/contracts/finance";
import { nextCalendarDate } from "@repo/finance";
import { Effect } from "effect";

import { lines, text, type PdfPage } from "./text.ts";
import { absoluteMoney, fullDates, pdfDate, pdfMoney } from "./values.ts";

export const metadata = Effect.fn(function* (pages: ReadonlyArray<PdfPage>) {
  const all = pages.flat();
  const kind: (typeof BankAccount.Type)["kind"] = all.some((item) =>
    /Home Loan Transactions/.test(item.str),
  )
    ? "loan"
    : all.some((item) => /^Ultimate Awards Credit Card$/.test(item.str))
      ? "card"
      : "deposit";
  const header =
    pages.find((page) =>
      page.some((item) => item.x > 350 && /[Ss]tatement [Pp]eriod/.test(item.str)),
    ) ??
    pages[0] ??
    [];
  const periodLine = lines(header).find(
    (line) => line.some((item) => item.x > 350) && [...text(line).matchAll(fullDates)].length === 2,
  );
  const dates = [...text(periodLine ?? []).matchAll(fullDates)].map((match) => match[0]);
  const start = dates[0]
    ? yield* pdfDate(dates[0], { start: null, end: null }).pipe(Effect.orElseSucceed(() => null))
    : null;
  const end = dates[1]
    ? yield* pdfDate(dates[1], { start: null, end: null }).pipe(Effect.orElseSucceed(() => null))
    : null;
  const number = header
    .find((item) => item.x > 450 && item.y > 730 && /^\d[\d ]{7,18}$/.test(item.str))
    ?.str.replace(/\s/g, "");
  const account: typeof BankAccount.Type | null = number
    ? {
        kind,
        currency: "AUD",
        bankId: kind === "deposit" ? number.slice(0, 6) : null,
        accountNumber: kind === "deposit" ? number.slice(6) : number,
      }
    : null;
  let statement: Statement = {
    statedStart: start,
    statedEnd: end,
    opening: null,
    closing: null,
    debitTotal: null,
    creditTotal: null,
    order: "ascending",
    raw: { period: text(periodLine ?? []) },
  };
  if (kind === "card") {
    for (const line of lines(header)) {
      const label = line.find((item) => item.x < 100)?.str ?? "";
      const literal = text(line.filter((item) => item.x > 200 && item.x < 300));
      if (!literal) continue;
      if (/^(Opening balance|Closing balance|New transactions|Payments\/refunds)/.test(label))
        statement = { ...statement, raw: { ...statement.raw, [label]: literal } };
      if (label.startsWith("Opening balance") && start)
        statement = {
          ...statement,
          opening: { on: start, money: yield* pdfMoney(literal, true, true) },
        };
      if (label.startsWith("Closing balance") && end)
        statement = {
          ...statement,
          closing: { on: nextCalendarDate(end), money: yield* pdfMoney(literal, true, true) },
        };
      if (label.startsWith("New transactions"))
        statement = {
          ...statement,
          debitTotal: absoluteMoney(yield* pdfMoney(literal, false, true)),
        };
      if (label.startsWith("Payments/refunds"))
        statement = {
          ...statement,
          creditTotal: absoluteMoney(yield* pdfMoney(literal, false, true)),
        };
    }
  }
  if (kind === "deposit") {
    for (const page of pages) {
      const headings = page.filter(
        (item) => item.str === "Total debits" || item.str === "Total credits",
      );
      for (const heading of headings) {
        const values = page.filter(
          (item) =>
            item.y < heading.y - 3 &&
            item.y > heading.y - 30 &&
            item.x >= heading.x &&
            item.x < heading.x + 80,
        );
        const money = yield* pdfMoney(text(values));
        statement =
          heading.str === "Total debits"
            ? { ...statement, debitTotal: absoluteMoney(money) }
            : { ...statement, creditTotal: absoluteMoney(money) };
      }
    }
  }
  return { kind, account, statement };
});
