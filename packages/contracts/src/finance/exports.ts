import { Schema } from "effect";

import { CommandId, Instant, SourceFileId } from "./values.ts";

export const ExportId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("ExportId"));
export const ExportInput = Schema.Struct({ exportId: ExportId });
export const RequestExport = Schema.Struct({
  commandId: CommandId,
  includeSources: Schema.Boolean,
});
export const ExportManifest = Schema.Struct({
  formatVersion: Schema.Literal(1),
  snapshotAt: Instant,
  includeSources: Schema.Boolean,
  tables: Schema.Array(
    Schema.Struct({ name: Schema.String, path: Schema.String, count: Schema.Int }),
  ),
  sources: Schema.Array(
    Schema.Struct({
      id: SourceFileId,
      fileName: Schema.String,
      path: Schema.NullOr(Schema.String),
      bytesAvailable: Schema.Boolean,
    }),
  ),
});
export const ExportRecord = Schema.Struct({
  id: ExportId,
  status: Schema.Literals(["processing", "ready", "failed"]),
  includeSources: Schema.Boolean,
  manifest: Schema.NullOr(ExportManifest),
  expiresAt: Schema.NullOr(Instant),
  failure: Schema.NullOr(Schema.Struct({ message: Schema.String })),
  requestedAt: Instant,
});
export type ExportRecord = typeof ExportRecord.Type;
