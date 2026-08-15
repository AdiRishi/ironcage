import type { CalendarDate } from "@ironcage/domain";
import { BigDecimal, Effect } from "effect";

import { BankImportBlocked, blocked } from "./block";

export interface StatementRow {
  readonly ordinal: number;
  readonly postedDate: CalendarDate;
  readonly amount: BigDecimal.BigDecimal;
  readonly balance: BigDecimal.BigDecimal;
  readonly narrative: string;
}

export interface ParsedStatement {
  readonly accountNumber: string;
  readonly period: { readonly start: CalendarDate; readonly end: CalendarDate };
  readonly opening: BigDecimal.BigDecimal;
  readonly closing: BigDecimal.BigDecimal;
  readonly totalDebits: BigDecimal.BigDecimal;
  readonly totalCredits: BigDecimal.BigDecimal;
  readonly rows: readonly StatementRow[];
}

const grammarFailure = (detail: string) => blocked("StatementGrammar", detail);

const months: Readonly<Record<string, number>> = {
  Jan: 1,
  Feb: 2,
  Mar: 3,
  Apr: 4,
  May: 5,
  Jun: 6,
  Jul: 7,
  Aug: 8,
  Sep: 9,
  Oct: 10,
  Nov: 11,
  Dec: 12,
};

const amountPattern = /^\$?\d{1,3}(,\d{3})*\.\d{2}$/;
const dayPattern = /^\d{1,2}$/;

const parseAmountToken = (token: string) => BigDecimal.fromStringUnsafe(token.replace(/[$,]/g, ""));

const currencyCodes = new Set(["USD", "AUD", "EUR", "GBP", "INR", "NZD", "SGD", "JPY", "CAD"]);

// AnyDoc renders the same visual table as prose, Markdown rows, or separated
// columns across pages. A token stream is the stable shape shared by all three.
const tokenize = (markdown: string): string[] => {
  const tokens: string[] = [];
  for (const line of markdown.split("\n")) {
    const stripped = line
      .replace(/<\/?u>/g, " ")
      .replace(/^#+\s*/, "")
      .replace(/^\s*\|(-{2,}\|)+\s*$/, " ")
      .replace(/\|/g, " ");
    for (const token of stripped.split(/\s+/)) {
      if (token !== "") tokens.push(token);
    }
  }
  return tokens;
};

const dateFrom = (year: number, month: number, day: number): CalendarDate | null => {
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
    ? (utc.toISOString().slice(0, 10) as CalendarDate)
    : null;
};

interface HeaderIdentity {
  readonly accountNumber: string;
  readonly period: { readonly start: CalendarDate; readonly end: CalendarDate };
  readonly headerClosing: BigDecimal.BigDecimal;
}

const signedBalance = (amount: BigDecimal.BigDecimal, marker: string) =>
  marker === "DR" ? BigDecimal.negate(amount) : amount;

const parseHeader = Effect.fn("parseStatementHeader")(function* (
  tokens: readonly string[],
): Effect.fn.Return<HeaderIdentity, BankImportBlocked> {
  const find = (sequence: readonly string[]) => {
    for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
      if (sequence.every((word, offset) => tokens[index + offset] === word)) return index;
    }
    return -1;
  };

  const accountAt = find(["Account", "Number"]);
  if (accountAt < 0) return yield* grammarFailure("no account number");
  const digits: string[] = [];
  for (
    let index = accountAt + 2;
    index < tokens.length && digits.length < 3 && /^\d+$/.test(tokens[index]!);
    index += 1
  ) {
    digits.push(tokens[index]!);
  }
  if (digits.length !== 3 || digits[0]!.length + digits[1]!.length !== 6) {
    return yield* grammarFailure("account number is not a split BSB and account");
  }

  const periodAt = find(["Statement", "Period"]);
  if (periodAt < 0) return yield* grammarFailure("no statement period");
  const readPeriodDate = (start: number) => {
    const day = tokens[start];
    const month = tokens[start + 1];
    const year = tokens[start + 2];
    if (
      day === undefined ||
      month === undefined ||
      year === undefined ||
      !dayPattern.test(day) ||
      months[month] === undefined ||
      !/^\d{4}$/.test(year)
    ) {
      return null;
    }
    return dateFrom(Number(year), months[month], Number(day));
  };
  const start = readPeriodDate(periodAt + 2);
  const separator = tokens[periodAt + 5];
  const end = readPeriodDate(periodAt + 6);
  if (start === null || end === null || separator !== "-" || start > end) {
    return yield* grammarFailure("unreadable statement period");
  }

  const closingAt = find(["Closing", "Balance"]);
  if (closingAt < 0) return yield* grammarFailure("no header closing balance");
  const closingToken = tokens[closingAt + 2];
  const closingMarker = tokens[closingAt + 3];
  if (
    closingToken === undefined ||
    !amountPattern.test(closingToken) ||
    (closingMarker !== "CR" && closingMarker !== "DR")
  ) {
    return yield* grammarFailure("unreadable header closing balance");
  }

  return {
    accountNumber: digits.join(" "),
    period: { start, end },
    headerClosing: signedBalance(parseAmountToken(closingToken), closingMarker),
  };
});

type StreamEvent =
  | { readonly kind: "date"; readonly index: number; readonly date: CalendarDate }
  | { readonly kind: "balance"; readonly index: number; readonly value: BigDecimal.BigDecimal }
  | { readonly kind: "amount"; readonly index: number; readonly value: BigDecimal.BigDecimal }
  | { readonly kind: "text"; readonly index: number; readonly text: string };

export const parseOffsetStatement = Effect.fn("parseOffsetStatement")(function* (
  markdown: string,
): Effect.fn.Return<ParsedStatement, BankImportBlocked> {
  const tokens = tokenize(markdown);
  const header = yield* parseHeader(tokens);

  const inferYear = (month: number, day: number): CalendarDate | null => {
    const startYear = Number(header.period.start.slice(0, 4));
    const endYear = Number(header.period.end.slice(0, 4));
    for (let year = startYear; year <= endYear; year += 1) {
      const candidate = dateFrom(year, month, day);
      if (
        candidate !== null &&
        candidate >= header.period.start &&
        candidate <= header.period.end
      ) {
        return candidate;
      }
    }
    return null;
  };

  let opening: BigDecimal.BigDecimal | null = null;
  let closing: BigDecimal.BigDecimal | null = null;
  const events: StreamEvent[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;

    if (token === "OPENING" && tokens[index + 1] === "BALANCE") {
      const amount = tokens[index + 2];
      const marker = tokens[index + 3];
      if (
        amount === undefined ||
        !amountPattern.test(amount) ||
        (marker !== "CR" && marker !== "DR")
      ) {
        return yield* grammarFailure("unreadable opening balance sentinel");
      }
      if (opening !== null) return yield* grammarFailure("duplicate opening balance sentinel");
      opening = signedBalance(parseAmountToken(amount), marker);
      index += 3;
      continue;
    }

    if (token === "CLOSING" && tokens[index + 1] === "BALANCE") {
      const amount = tokens[index + 2];
      const marker = tokens[index + 3];
      if (
        amount === undefined ||
        !amountPattern.test(amount) ||
        (marker !== "CR" && marker !== "DR")
      ) {
        return yield* grammarFailure("unreadable closing balance sentinel");
      }
      closing = signedBalance(parseAmountToken(amount), marker);
      const sentinelDate = events.findLastIndex(
        (event) => event.kind === "date" && event.index >= index - 4,
      );
      if (sentinelDate >= 0) events.splice(sentinelDate, 1);
      index += 3;
      continue;
    }

    if (opening === null || closing !== null) continue;

    const nextToken = tokens[index + 1];
    if (nextToken !== undefined && months[nextToken] !== undefined && /\d$/.test(token)) {
      // Page furniture can fuse onto a transaction day, such as "...2.820".
      const candidates = dayPattern.test(token)
        ? [token]
        : [token.slice(-2), token.slice(-1)].filter((digits) => /^[1-9]\d?$/.test(digits));
      let matched: CalendarDate | null = null;
      for (const digits of candidates) {
        const date = inferYear(months[nextToken]!, Number(digits));
        const lastDate = events.filter((event) => event.kind === "date").at(-1)?.date;
        if (date !== null && (lastDate === undefined || date >= lastDate)) {
          matched = date;
          break;
        }
      }
      if (matched !== null) {
        events.push({ kind: "date", index, date: matched });
        index += 1;
        continue;
      }
    }

    if (amountPattern.test(token)) {
      const marker = tokens[index + 1];
      if (marker === "CR" || marker === "DR") {
        events.push({
          kind: "balance",
          index,
          value: signedBalance(parseAmountToken(token), marker),
        });
        index += 1;
        continue;
      }
      const previous = tokens[index - 1];
      if (previous !== undefined && currencyCodes.has(previous)) {
        events.push({ kind: "text", index, text: token });
        continue;
      }
      events.push({ kind: "amount", index, value: parseAmountToken(token) });
      continue;
    }

    events.push({ kind: "text", index, text: token });
  }

  if (opening === null) return yield* grammarFailure("no opening balance sentinel");
  if (closing === null) return yield* grammarFailure("no closing balance sentinel");

  const dates = events.filter((event) => event.kind === "date");
  const balances = events.filter((event) => event.kind === "balance");
  const printedAmounts = events.filter((event) => event.kind === "amount");

  if (dates.length !== balances.length) {
    return yield* grammarFailure(
      `${dates.length} transaction dates against ${balances.length} balances; the statement does not reconstruct`,
    );
  }
  if (dates.length === 0) return yield* grammarFailure("no transactions between the sentinels");

  if (!dates.every((event, index) => index === 0 || event.date >= dates[index - 1]!.date)) {
    return yield* grammarFailure("transaction dates are not in statement order");
  }

  const rows: StatementRow[] = [];
  let previous = opening;
  // The running-balance chain supplies row identity; printed debit/credit
  // amounts independently corroborate every derived step below.
  for (const [ordinal, balanceEvent] of balances.entries()) {
    const balance = balanceEvent.value;
    rows.push({
      ordinal,
      postedDate: dates[ordinal]!.date,
      amount: BigDecimal.subtract(balance, previous),
      balance,
      narrative: "",
    });
    previous = balance;
  }

  if (!BigDecimal.equals(previous, closing)) {
    return yield* blocked(
      "StatementReconciliation",
      `the final running balance ${BigDecimal.format(previous)} is not the closing balance ${BigDecimal.format(closing)}`,
    );
  }
  if (!BigDecimal.equals(closing, header.headerClosing)) {
    return yield* blocked(
      "StatementReconciliation",
      "the closing sentinel disagrees with the header closing balance",
    );
  }

  const pool = new Map<string, number>();
  for (const event of printedAmounts) {
    const key = BigDecimal.format(BigDecimal.normalize(event.value));
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (BigDecimal.isZero(row.amount)) {
      return yield* grammarFailure(`row ${row.ordinal + 1} has a zero balance step`);
    }
    const key = BigDecimal.format(BigDecimal.normalize(BigDecimal.abs(row.amount)));
    const available = pool.get(key) ?? 0;
    if (available === 0) {
      return yield* grammarFailure(
        `derived amount ${key} for row ${row.ordinal + 1} has no printed counterpart`,
      );
    }
    pool.set(key, available - 1);
  }
  const unconsumed = [...pool.values()].reduce((sum, count) => sum + count, 0);
  if (unconsumed !== 0) {
    return yield* grammarFailure(`${unconsumed} printed amounts have no transaction`);
  }

  const textByRange = (from: number, to: number) =>
    events
      .flatMap((event) =>
        event.kind === "text" && event.index > from && event.index < to ? [event.text] : [],
      )
      .join(" ");
  // Continuation lines belong to the transaction that precedes the next date.
  const narratives = dates.map((event, ordinal) =>
    textByRange(event.index + 1, dates[ordinal + 1]?.index ?? Number.MAX_SAFE_INTEGER),
  );

  const totalsAt = tokens.findIndex(
    (token, index) => token.endsWith("Total") && tokens[index + 1] === "debits",
  );
  if (totalsAt < 0) return yield* grammarFailure("no summary totals");
  const totalsTail = tokens.slice(totalsAt).filter((token) => amountPattern.test(token));
  if (totalsTail.length < 4) return yield* grammarFailure("unreadable summary totals");
  const printedOpening = parseAmountToken(totalsTail[0]!);
  const printedDebits = parseAmountToken(totalsTail[1]!);
  const printedCredits = parseAmountToken(totalsTail[2]!);
  const printedClosing = parseAmountToken(totalsTail[3]!);

  const zero = BigDecimal.fromBigInt(0n);
  const computedDebits = rows.reduce(
    (sum, row) =>
      BigDecimal.isNegative(row.amount) ? BigDecimal.sum(sum, BigDecimal.abs(row.amount)) : sum,
    zero,
  );
  const computedCredits = rows.reduce(
    (sum, row) => (BigDecimal.isPositive(row.amount) ? BigDecimal.sum(sum, row.amount) : sum),
    zero,
  );

  if (
    !BigDecimal.equals(printedOpening, BigDecimal.abs(opening)) ||
    !BigDecimal.equals(printedClosing, BigDecimal.abs(closing)) ||
    !BigDecimal.equals(printedDebits, computedDebits) ||
    !BigDecimal.equals(printedCredits, computedCredits)
  ) {
    return yield* blocked(
      "StatementReconciliation",
      `summary totals disagree: recomputed debits ${BigDecimal.format(computedDebits)} and credits ${BigDecimal.format(computedCredits)} against printed ${BigDecimal.format(printedDebits)} and ${BigDecimal.format(printedCredits)}`,
    );
  }

  return {
    accountNumber: header.accountNumber,
    period: header.period,
    opening,
    closing,
    totalDebits: computedDebits,
    totalCredits: computedCredits,
    rows: rows.map((row, ordinal) => ({ ...row, narrative: narratives[ordinal] ?? "" })),
  };
});
