import { Schema } from "effect";

import { Import } from "./imports.ts";
import { AccountId, CalendarDate, CommandId, SourceFileId, Version } from "./values.ts";

export const SourceFile = Schema.Struct({
  id: SourceFileId,
  fileName: Schema.String,
  byteSize: Schema.String,
  bytesAvailable: Schema.Boolean,
  version: Version,
  importId: Import.fields.id,
  format: Import.fields.format,
  status: Import.fields.status,
  postingCount: Schema.Int,
  accountId: Schema.NullOr(AccountId),
  firstOn: Schema.NullOr(CalendarDate),
  lastOn: Schema.NullOr(CalendarDate),
});
export type SourceFile = typeof SourceFile.Type;
export const RemoveSourceBytes = Schema.Struct({
  commandId: CommandId,
  sourceFileId: SourceFileId,
  expectedVersion: Version,
});
export const SourceRemoval = Schema.Struct({
  sourceFileId: SourceFileId,
  affectedPostingCount: Schema.Int,
});
