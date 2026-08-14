import type { CalendarDate } from "@ironcage/domain";
import { BigDecimal, Effect } from "effect";

import { BankImportBlocked, blocked } from "./block";

/**
 * The `cba-offset-statement-v1` parser over AnyDoc-extracted Markdown.
 *
 * The extractor fragments visual rows: one transaction can span several
 * Markdown table rows, a page's table can arrive as running prose, and the
 * last pages arrive as separated narrative, amount, and balance columns. The
 * reconstruction is therefore chain-anchored rather than cell-anchored:
 *
 * 1. The ordered balance sequence (`amount CR|DR`) and the ordered date
 *    markers are the row skeleton — their counts must agree.
 * 2. Every row's signed amount is derived from its balance step, so the
 *    chain equation holds by construction.
 * 3. The printed amount column is then consumed as evidence: the multiset of
 *    printed amounts must equal the multiset of derived amounts exactly, and
 *    the recomputed totals must match the statement's printed summary and
 *    closing equation.
 *
 * Anything that does not reconcile blocks the whole statement.
 */

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

const fail = (detail: string) => blocked("StatementGrammar", detail);

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

/** Currency codes whose following amount is narrative, never a column value. */
const currencyCodes = new Set(["USD", "AUD", "EUR", "GBP", "INR", "NZD", "SGD", "JPY", "CAD"]);

/**
 * Flattens the Markdown into one whitespace token stream in document order:
 * table cells row-major, prose as-is, Markdown decoration removed.
 */
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

  // The printed account number is exactly three groups — the split BSB and
  // the account — and other long digit runs can follow it on the same line.
  const accountAt = find(["Account", "Number"]);
  if (accountAt < 0) return yield* fail("no account number");
  const digits: string[] = [];
  for (
    let index = accountAt + 2;
    index < tokens.length && digits.length < 3 && /^\d+$/.test(tokens[index]!);
    index += 1
  ) {
    digits.push(tokens[index]!);
  }
  if (digits.length !== 3 || digits[0]!.length + digits[1]!.length !== 6) {
    return yield* fail("account number is not a split BSB and account");
  }

  const periodAt = find(["Statement", "Period"]);
  if (periodAt < 0) return yield* fail("no statement period");
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
    return yield* fail("unreadable statement period");
  }

  const closingAt = find(["Closing", "Balance"]);
  if (closingAt < 0) return yield* fail("no header closing balance");
  const closingToken = tokens[closingAt + 2];
  const closingMarker = tokens[closingAt + 3];
  if (
    closingToken === undefined ||
    !amountPattern.test(closingToken) ||
    (closingMarker !== "CR" && closingMarker !== "DR")
  ) {
    return yield* fail("unreadable header closing balance");
  }

  return {
    accountNumber: digits.join(" "),
    period: { start, end },
    headerClosing: signedBalance(parseAmountToken(closingToken), closingMarker),
  };
});

interface StreamEvent {
  readonly kind: "date" | "balance" | "amount" | "text";
  readonly index: number;
  readonly date?: CalendarDate;
  readonly value?: BigDecimal.BigDecimal;
  readonly text?: string;
}

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

  // One linear pass classifies the stream between the opening and closing
  // sentinels into date markers, balances, candidate amounts, and narrative.
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
        return yield* fail("unreadable opening balance sentinel");
      }
      if (opening !== null) return yield* fail("duplicate opening balance sentinel");
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
        return yield* fail("unreadable closing balance sentinel");
      }
      closing = signedBalance(parseAmountToken(amount), marker);
      // The sentinel row prints its own date ("24 Jun 2026 CLOSING BALANCE");
      // that marker belongs to the sentinel, not to a transaction.
      const sentinelDate = events.findLastIndex(
        (event) => event.kind === "date" && event.index >= index - 4,
      );
      if (sentinelDate >= 0) events.splice(sentinelDate, 1);
      index += 3;
      continue;
    }

    if (opening === null || closing !== null) continue;

    // "12 Mar" begins a transaction; "Value Date 12/03/2026" never matches
    // because its day/month arrive as one slashed token. The extractor also
    // fuses print artifacts onto the day ("…8002.1602.2.831 May"), so a token
    // ending in digits recovers its trailing day when a month follows.
    const nextToken = tokens[index + 1];
    if (nextToken !== undefined && months[nextToken] !== undefined && /\d$/.test(token)) {
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
        // A foreign-currency annotation inside the narrative, not a column.
        events.push({ kind: "text", index, text: token });
        continue;
      }
      events.push({ kind: "amount", index, value: parseAmountToken(token) });
      continue;
    }

    events.push({ kind: "text", index, text: token });
  }

  if (opening === null) return yield* fail("no opening balance sentinel");
  if (closing === null) return yield* fail("no closing balance sentinel");

  const dates = events.filter((event) => event.kind === "date");
  const balances = events.filter((event) => event.kind === "balance");
  const printedAmounts = events.filter((event) => event.kind === "amount");

  if (dates.length !== balances.length) {
    return yield* fail(
      `${dates.length} transaction dates against ${balances.length} balances; the statement does not reconstruct`,
    );
  }
  if (dates.length === 0) return yield* fail("no transactions between the sentinels");

  const rowDates = dates.map((event) => event.date!);
  if (!rowDates.every((date, index) => index === 0 || date >= rowDates[index - 1]!)) {
    return yield* fail("transaction dates are not in statement order");
  }

  // The chain: every amount is the step between consecutive balances.
  const rows: StatementRow[] = [];
  let previous = opening;
  for (const [ordinal, balanceEvent] of balances.entries()) {
    const balance = balanceEvent.value!;
    rows.push({
      ordinal,
      postedDate: rowDates[ordinal]!,
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

  // Printed amounts are evidence, not decoration: the multiset of printed
  // column values must equal the multiset of derived magnitudes exactly.
  const pool = new Map<string, number>();
  for (const event of printedAmounts) {
    const key = BigDecimal.format(BigDecimal.normalize(event.value!));
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  for (const row of rows) {
    if (BigDecimal.isZero(row.amount)) {
      return yield* fail(`row ${row.ordinal + 1} has a zero balance step`);
    }
    const key = BigDecimal.format(BigDecimal.normalize(BigDecimal.abs(row.amount)));
    const available = pool.get(key) ?? 0;
    if (available === 0) {
      return yield* fail(
        `derived amount ${key} for row ${row.ordinal + 1} has no printed counterpart`,
      );
    }
    pool.set(key, available - 1);
  }
  const unconsumed = [...pool.values()].reduce((sum, count) => sum + count, 0);
  if (unconsumed !== 0) {
    return yield* fail(`${unconsumed} printed amounts have no transaction`);
  }

  // Narrative: the text between a row's date marker and the next marker.
  const textByRange = (from: number, to: number) =>
    events
      .filter((event) => event.kind === "text" && event.index > from && event.index < to)
      .map((event) => event.text!)
      .join(" ");
  const narratives = dates.map((event, ordinal) =>
    textByRange(event.index + 1, dates[ordinal + 1]?.index ?? Number.MAX_SAFE_INTEGER),
  );

  // The printed summary totals, recomputed from parsed rows rather than
  // trusted: closing = opening − total debits + total credits.
  // The summary line prints as "Opening balance-Total debits Total credits =
  // Closing balance", so the anchor tolerates the fused first token.
  const totalsAt = tokens.findIndex(
    (token, index) => token.endsWith("Total") && tokens[index + 1] === "debits",
  );
  if (totalsAt < 0) return yield* fail("no summary totals");
  const totalsTail = tokens.slice(totalsAt).filter((token) => amountPattern.test(token));
  if (totalsTail.length < 4) return yield* fail("unreadable summary totals");
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
