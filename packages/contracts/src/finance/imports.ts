import { Schema } from "effect";

import {
  AccountId,
  AccountKind,
  CalendarDate,
  Currency,
  CommandId,
  RecordCursor,
  ImportId,
  Instant,
  Institution,
  Money,
  SourceFileId,
  Version,
} from "./values.ts";

export const SourceFormat = Schema.Literals(["csv", "ofx", "pdf"]);
export const DocumentPages = Schema.Struct({
  count: Schema.Int,
  decoded: Schema.Int,
  needingReview: Schema.Array(Schema.Int),
});

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
  institution: Institution,
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
  pages: Schema.optionalKey(DocumentPages),
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
  pages: Schema.optionalKey(DocumentPages),
});
export type ImportSummary = typeof ImportSummary.Type;
export const Import = Schema.Struct({
  id: ImportId,
  sourceFileId: SourceFileId,
  accountId: Schema.NullOr(AccountId),
  fileName: Schema.String,
  format: SourceFormat,
  status: Schema.Literals(["processing", "needs_review", "complete", "failed"]),
  summary: Schema.NullOr(ImportSummary),
  failure: Schema.NullOr(Schema.Struct({ message: Schema.String })),
  version: Version,
  createdAt: Instant,
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
  format: SourceFormat,
  institution: Institution,
  currency: Currency,
  bytesAvailable: Schema.Boolean,
});
// A file with an account belongs to that account's institution; a file without one
// names the institution whose formats it uses.
export const UploadInput = Schema.Struct({
  fileName: Schema.String,
  mediaType: Schema.String,
  accountId: Schema.NullOr(AccountId),
  institution: Institution,
  bytes: Schema.Uint8Array,
});
export type UploadInput = typeof UploadInput.Type;

export const ImportJob = Schema.Struct({ importId: ImportId, instanceId: Schema.String });
export const RetryImport = Schema.Struct({
  commandId: CommandId,
  importId: ImportId,
  expectedVersion: Version,
});
export const FailImport = Schema.Struct({
  ...ImportJob.fields,
  failure: Schema.Struct({ message: Schema.String }),
});

export const ListImports = Schema.Struct({ cursor: Schema.optionalKey(RecordCursor) });
export const ImportPage = Schema.Struct({
  rows: Schema.Array(Import),
  nextCursor: Schema.NullOr(RecordCursor),
});
export type ImportPage = typeof ImportPage.Type;
