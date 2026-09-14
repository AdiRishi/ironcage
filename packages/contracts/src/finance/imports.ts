import { Schema } from "effect";

import {
  AccountId,
  AccountKind,
  CalendarDate,
  Currency,
  ImportId,
  Money,
  SourceFileId,
  Version,
} from "./values.ts";

export const Locator = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("csvLine"), line: Schema.Int }),
  Schema.Struct({
    kind: Schema.Literal("ofxTransaction"),
    statement: Schema.Int,
    ordinal: Schema.Int,
  }),
  Schema.Struct({
    kind: Schema.Literal("pdfRow"),
    page: Schema.Int,
    row: Schema.Int,
    bbox: Schema.optionalKey(
      Schema.Tuple([Schema.Finite, Schema.Finite, Schema.Finite, Schema.Finite]),
    ),
  }),
]);
export const Candidate = Schema.Struct({
  postedOn: CalendarDate,
  valueOn: Schema.NullOr(CalendarDate),
  amount: Money,
  description: Schema.String,
  balance: Schema.NullOr(Money),
  bankId: Schema.NullOr(Schema.String),
  originalMoney: Schema.NullOr(Money),
});
export type Candidate = typeof Candidate.Type;
export const Issue = Schema.Struct({
  code: Schema.Literals([
    "unreadableAmount",
    "unreadableDate",
    "unknownAccount",
    "unsupportedLayout",
  ]),
  literal: Schema.String,
});
export const ParsedObservation = Schema.Struct({
  locatorKey: Schema.String,
  locator: Locator,
  raw: Schema.Record(Schema.String, Schema.String),
  candidate: Schema.NullOr(Candidate),
  issue: Schema.NullOr(Issue),
});
export type ParsedObservation = typeof ParsedObservation.Type;
export const BankAccount = Schema.Struct({
  bankId: Schema.NullOr(Schema.String),
  accountNumber: Schema.NonEmptyString,
  kind: AccountKind,
  currency: Currency,
});
export const Anchor = Schema.Struct({ on: CalendarDate, money: Money });
export const Statement = Schema.Struct({
  statedStart: Schema.NullOr(CalendarDate),
  statedEnd: Schema.NullOr(CalendarDate),
  opening: Schema.NullOr(Anchor),
  closing: Schema.NullOr(Anchor),
  debitTotal: Schema.NullOr(Money),
  creditTotal: Schema.NullOr(Money),
  raw: Schema.Record(Schema.String, Schema.String),
  order: Schema.Literals(["ascending", "descending"]),
});
export type Statement = typeof Statement.Type;
export const ParsedFile = Schema.Struct({
  parserVersion: Schema.String,
  account: Schema.NullOr(BankAccount),
  statement: Statement,
  observations: Schema.Array(ParsedObservation),
});
export type ParsedFile = typeof ParsedFile.Type;
export const PublishImport = Schema.Struct({ importId: ImportId, ...ParsedFile.fields });
export const ImportSummary = Schema.Struct({
  observations: Schema.Int,
  newPostings: Schema.Int,
  matchedPostings: Schema.Int,
  reviewItems: Schema.Int,
});
export type ImportSummary = typeof ImportSummary.Type;
export const Import = Schema.Struct({
  id: ImportId,
  sourceFileId: SourceFileId,
  accountId: Schema.NullOr(AccountId),
  fileName: Schema.String,
  format: Schema.Literals(["csv", "ofx"]),
  status: Schema.Literals(["processing", "needs_review", "complete", "failed"]),
  summary: Schema.NullOr(ImportSummary),
  failure: Schema.NullOr(Schema.Struct({ message: Schema.String })),
  version: Version,
  createdAt: Schema.String,
});
export type Import = typeof Import.Type;
export const ImportInput = Schema.Struct({ importId: ImportId });
export const UploadResult = Schema.Struct({
  importId: ImportId,
  sourceFileId: SourceFileId,
  existing: Schema.Boolean,
});
export const SourceFileInput = Schema.Struct({ sourceFileId: SourceFileId });
export const ImportSource = Schema.Struct({
  importId: ImportId,
  objectKey: Schema.String,
  format: Schema.Literals(["csv", "ofx"]),
  currency: Currency,
  bytesAvailable: Schema.Boolean,
});
export const UploadInput = Schema.Struct({
  fileName: Schema.String,
  mediaType: Schema.String,
  accountId: Schema.NullOr(AccountId),
  bytes: Schema.Uint8Array,
});
export type UploadInput = typeof UploadInput.Type;
