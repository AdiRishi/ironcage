import {
  AccountKind,
  BankAccount,
  Currency,
  FinanceError,
  type ParsedFile,
} from "@repo/contracts/finance";
import { decodeEntities, nextCalendarDate, parseCalendarDate, parseMoney } from "@repo/finance";
import { Effect, Schema } from "effect";
import { parseSync } from "ofx-js";

import { parseDescription } from "./description.ts";
import { issue, observation } from "./observation.ts";

const Fields = Schema.Record(Schema.String, Schema.String);
const Transaction = Schema.Struct({
  TRNAMT: Schema.String,
  DTPOSTED: Schema.String,
  DTUSER: Schema.optional(Schema.String),
  MEMO: Schema.optional(Schema.String),
  NAME: Schema.optional(Schema.String),
  FITID: Schema.optional(Schema.String),
  TRNTYPE: Schema.String,
});
const Statement = Schema.Struct({
  CURDEF: Currency,
  BANKACCTFROM: Schema.optional(Fields),
  CCACCTFROM: Schema.optional(Fields),
  BANKTRANLIST: Schema.Struct({
    DTSTART: Schema.String,
    DTEND: Schema.String,
    STMTTRN: Schema.optional(Schema.Union([Fields, Schema.Array(Fields)])),
  }),
  LEDGERBAL: Schema.Struct({ BALAMT: Schema.String, DTASOF: Schema.String }),
  AVAILBAL: Schema.optional(Fields),
});
const Document = Schema.Struct({
  OFX: Schema.Struct({
    BANKMSGSRSV1: Schema.optional(
      Schema.Struct({ STMTTRNRS: Schema.Struct({ STMTRS: Statement }) }),
    ),
    CREDITCARDMSGSRSV1: Schema.optional(
      Schema.Struct({ CCSTMTTRNRS: Schema.Struct({ CCSTMTRS: Statement }) }),
    ),
  }),
});
const OfxDate = Schema.String.check(
  Schema.isPattern(/^\d{8}(?:(?:[01]\d|2[0-3])[0-5]\d[0-5]\d)?$/),
);
const date = Effect.fnUntraced(function* (text: string) {
  yield* Schema.decodeEffect(OfxDate)(text).pipe(
    Effect.mapError(
      () =>
        new FinanceError({
          kind: "invalid",
          message: "Expected an OFX date without a timezone offset.",
        }),
    ),
  );
  return yield* parseCalendarDate(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`);
});
export const parseOfx = Effect.fn("parseOfx")(function* (bytes: Uint8Array) {
  let text = new TextDecoder("windows-1252").decode(bytes);
  // CommBank emits empty SGML leaves and a CREDITLINE wrapper with mismatched tags.
  text = text.replace(/<FITID>\s*(?=<)/g, "<FITID></FITID>");
  if (/<ACCTTYPE>\s*CREDITLINE\s*</.test(text)) text = text.replace(/<CCSTMTRS>/g, "<STMTRS>");
  // Preserve the source entity spelling through ofx-js's entity decoder.
  const document = yield* Effect.try(() => parseSync(text.replace(/&/g, "&amp;"))).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Document)),
    Effect.mapError(
      () => new FinanceError({ kind: "invalid", message: "Expected a CommBank OFX statement." }),
    ),
  );
  const statement =
    document.OFX.BANKMSGSRSV1?.STMTTRNRS.STMTRS ??
    document.OFX.CREDITCARDMSGSRSV1?.CCSTMTTRNRS.CCSTMTRS;
  if (!statement)
    return yield* new FinanceError({
      kind: "invalid",
      message: "The OFX file has no supported bank statement.",
    });
  const bank = statement.BANKACCTFROM ?? statement.CCACCTFROM;
  const kind: typeof AccountKind.Type = statement.CCACCTFROM
    ? "card"
    : bank?.ACCTTYPE === "CREDITLINE"
      ? "loan"
      : "deposit";
  const account = yield* Schema.decodeUnknownEffect(BankAccount)({
    bankId: bank?.BANKID?.trim() || null,
    accountNumber: bank?.ACCTID?.trim(),
    kind,
    currency: statement.CURDEF,
  }).pipe(
    Effect.mapError(
      () =>
        new FinanceError({ kind: "invalid", message: "The OFX account identity is unreadable." }),
    ),
  );
  const entries = statement.BANKTRANLIST.STMTTRN;
  const rows = entries === undefined ? [] : Array.isArray(entries) ? entries : [entries];
  const observations = yield* Effect.forEach(rows, (raw, index) =>
    observation(
      { kind: "ofxTransaction", statement: 1, ordinal: index + 1 },
      raw,
      Effect.gen(function* () {
        const row = yield* Schema.decodeUnknownEffect(Transaction)(raw).pipe(
          Effect.mapError(issue("unsupportedLayout", "Required OFX transaction fields")),
        );
        const postedOn = yield* date(row.DTPOSTED).pipe(
          Effect.mapError(issue("unreadableDate", row.DTPOSTED)),
        );
        const userDate = row.DTUSER
          ? yield* date(row.DTUSER).pipe(Effect.mapError(issue("unreadableDate", row.DTUSER)))
          : null;
        const name = decodeEntities(row.NAME ?? "").trim();
        const memo = decodeEntities(row.MEMO ?? "").trim();
        const description = yield* parseDescription(
          name && name !== memo ? `${name} ${memo}` : memo || name,
        ).pipe(Effect.mapError(issue("unsupportedLayout", row.MEMO ?? row.NAME ?? "")));
        return {
          postedOn,
          ...description,
          valueOn: userDate && userDate !== postedOn ? userDate : description.valueOn,
          amount: yield* parseMoney(row.TRNAMT, account.currency).pipe(
            Effect.mapError(issue("unreadableAmount", row.TRNAMT)),
          ),
          balance: null,
          bankId: row.FITID?.trim() || null,
        };
      }),
    ),
  );
  const ledgerDate = yield* date(statement.LEDGERBAL.DTASOF);
  const metadata: ParsedFile["statement"]["raw"] = {
    ...Object.fromEntries(
      Object.entries(statement.AVAILBAL ?? {}).map(([key, value]) => [`AVAILBAL_${key}`, value]),
    ),
    DTSTART: statement.BANKTRANLIST.DTSTART,
    DTEND: statement.BANKTRANLIST.DTEND,
    LEDGERBAL_BALAMT: statement.LEDGERBAL.BALAMT,
    LEDGERBAL_DTASOF: statement.LEDGERBAL.DTASOF,
  };
  return {
    parserVersion: "commbank-ofx-2",
    account,
    observations,
    statement: {
      statedStart: yield* date(statement.BANKTRANLIST.DTSTART),
      statedEnd: yield* date(statement.BANKTRANLIST.DTEND),
      opening: null,
      closing: {
        on: statement.LEDGERBAL.DTASOF.endsWith("235959")
          ? nextCalendarDate(ledgerDate)
          : ledgerDate,
        money: yield* parseMoney(statement.LEDGERBAL.BALAMT, account.currency),
      },
      debitTotal: null,
      creditTotal: null,
      order: "descending",
      raw: metadata,
    },
  } satisfies ParsedFile;
});
