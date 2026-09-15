import { FinanceError, type ParsedFile } from "@repo/contracts/finance";
import { parseBankDate, parseMoney } from "@repo/finance";
import { parse } from "csv-parse/sync";
import { Effect, Schema } from "effect";

import { parseDescription } from "./description.ts";
import { issue, observation } from "./observation.ts";

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
  const observations = yield* Effect.forEach(rows, ([date, amount, description, balance], index) =>
    observation(
      { kind: "csvLine", line: index + 1 },
      { date, amount, description, balance },
      Effect.gen(function* () {
        const postedOn = yield* parseBankDate(date).pipe(
          Effect.mapError(issue("unreadableDate", date)),
        );
        const money = yield* parseMoney(amount, currency).pipe(
          Effect.mapError(issue("unreadableAmount", amount)),
        );
        const fields = yield* parseDescription(description).pipe(
          Effect.mapError(issue("unsupportedLayout", description)),
        );
        return {
          postedOn,
          ...fields,
          amount: money,
          balance: balance
            ? yield* parseMoney(balance, currency).pipe(
                Effect.mapError(issue("unreadableAmount", balance)),
              )
            : null,
          bankId: null,
        };
      }),
    ),
  );
  return {
    parserVersion: "commbank-csv-2",
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
