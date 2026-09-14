import { FinanceError, type ParsedFile } from "@repo/contracts/finance";
import { parseBankDate, parseMoney } from "@repo/finance";
import { parse } from "csv-parse/sync";
import { Effect, Schema } from "effect";

import { parseDescription } from "./description.ts";

const CsvRows = Schema.Array(
  Schema.Tuple([Schema.String, Schema.String, Schema.String, Schema.String]),
);
export const parseCsv = Effect.fn("parseCsv")(function* (bytes: Uint8Array, currency: string) {
  const rows = yield* Effect.try(() => parse(bytes, { bom: true, relax_quotes: false })).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(CsvRows)),
    Effect.mapError(
      () =>
        new FinanceError({
          kind: "invalid",
          message: "Expected a CommBank CSV with four columns and no header.",
        }),
    ),
  );
  const observations = yield* Effect.forEach(
    rows,
    Effect.fn(function* ([date, amount, description, balance], index) {
      const postedOn = yield* parseBankDate(date);
      const money = yield* parseMoney(amount, currency);
      const fields = yield* parseDescription(description);
      return {
        locatorKey: `csvLine:${index + 1}`,
        locator: { kind: "csvLine" as const, line: index + 1 },
        raw: { date, amount, description, balance },
        candidate: {
          postedOn,
          ...fields,
          amount: money,
          balance: balance ? yield* parseMoney(balance, currency) : null,
          bankId: null,
        },
        issue: null,
      };
    }),
  );
  return {
    parserVersion: "commbank-csv-1",
    account: null,
    observations,
    statement: {
      statedStart: null,
      statedEnd: null,
      opening: null,
      closing: null,
      debitTotal: null,
      creditTotal: null,
      raw: {},
      order: "descending",
    },
  } satisfies ParsedFile;
});
