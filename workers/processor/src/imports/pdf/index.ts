import { FinanceError, type ParsedFile, type ParsedObservation } from "@repo/contracts/finance";
import { addDays } from "@repo/finance";
import { Effect } from "effect";
import { extractTextItems } from "unpdf";

import { parseDescription } from "../description.ts";
import { issue, locatorKey, observation } from "../observation.ts";
import { metadata } from "./metadata.ts";
import { tableRows, rawRow } from "./table.ts";
import { bounds, type PdfPage } from "./text.ts";
import { absoluteMoney, pdfDate, pdfMoney } from "./values.ts";

const decodeStatement = Effect.fn("decodeStatement")(function* (pages: ReadonlyArray<PdfPage>) {
  const meta = yield* metadata(pages);
  let statement = meta.statement;
  const observations: ParsedObservation[] = [];
  const period = { start: statement.statedStart, end: statement.statedEnd };
  for (const [index, page] of pages.entries()) {
    const rows = tableRows(page, index + 1, meta.kind);
    if (
      page.length === 0 ||
      (rows.length === 0 &&
        page.some(
          (item) =>
            (item.x < 100 && item.str === "Transactions") ||
            /Home Loan Transactions/.test(item.str),
        ))
    )
      observations.push({
        locatorKey: locatorKey({ kind: "pdfRow", page: index + 1, row: 1 }),
        locator: { kind: "pdfRow", page: index + 1, row: 1 },
        raw: { text: page.map((item) => item.str).join(" "), positions: JSON.stringify(page) },
        candidate: null,
        issue: { code: "unsupportedLayout", literal: "The transaction page could not be decoded." },
      });
    for (const row of rows) {
      const locator = {
        kind: "pdfRow" as const,
        page: row.page,
        row: row.row,
        bbox: bounds(row.items),
      };
      const raw = rawRow(row);
      if (/OPENING BALANCE|CLOSING BALANCE/i.test(row.description)) {
        const on = yield* pdfDate(row.date, period);
        const money = yield* pdfMoney(row.balance);
        statement = /OPENING/i.test(row.description)
          ? { ...statement, opening: { on, money } }
          : { ...statement, closing: { on: addDays(on, 1), money } };
        statement = {
          ...statement,
          raw: {
            ...statement.raw,
            [/OPENING/i.test(row.description) ? "opening" : "closing"]: JSON.stringify(raw),
          },
        };
        continue;
      }
      const notice =
        !row.balance &&
        !/\d/.test(row.debit + row.credit) &&
        /interest rate|minimum repayment|interest earned/i.test(row.description);
      const decoded = notice
        ? { locatorKey: locatorKey(locator), locator, raw, candidate: null, issue: null }
        : yield* observation(
            locator,
            raw,
            Effect.gen(function* () {
              const postedOn = yield* pdfDate(row.date, period).pipe(
                Effect.mapError(issue("unreadableDate", row.date)),
              );
              const literal = row.debit || row.credit;
              const money = yield* pdfMoney(literal, false, meta.kind === "card").pipe(
                Effect.mapError(issue("unreadableAmount", literal)),
              );
              const credit = meta.kind === "card" ? literal.endsWith("-") : Boolean(row.credit);
              const amount = { ...money, minor: absoluteMoney(money).minor * (credit ? 1n : -1n) };
              const fields = yield* parseDescription(row.description).pipe(
                Effect.mapError(issue("unsupportedLayout", row.description)),
              );
              return {
                postedOn,
                ...fields,
                amount,
                balance:
                  meta.kind === "card"
                    ? null
                    : yield* pdfMoney(row.balance).pipe(
                        Effect.mapError(issue("unreadableAmount", row.balance)),
                      ),
                bankId: null,
              };
            }),
          );
      // Zero-amount rows are printed notices such as a waived fee, not postings.
      observations.push({
        ...decoded,
        candidate: decoded.candidate?.amount.minor === 0n ? null : decoded.candidate,
      });
    }
  }
  const needingReview = [
    ...new Set(
      observations
        .filter((row) => row.issue)
        .flatMap((row) => (row.locator.kind === "pdfRow" ? [row.locator.page] : [])),
    ),
  ];
  statement = {
    ...statement,
    pages: { count: pages.length, decoded: pages.length - needingReview.length, needingReview },
  };
  return {
    parserVersion: "commbank-pdf-1",
    account: meta.account,
    statement,
    observations,
  } satisfies ParsedFile;
});
export const parsePdf = Effect.fn("parsePdf")(function* (bytes: Uint8Array) {
  const document = yield* Effect.tryPromise(() => extractTextItems(bytes)).pipe(
    Effect.mapError(
      () => new FinanceError({ kind: "invalid", message: "The PDF could not be read." }),
    ),
  );
  return yield* decodeStatement(document.items);
});
