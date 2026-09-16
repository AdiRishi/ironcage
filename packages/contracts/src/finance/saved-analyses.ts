import { Schema } from "effect";

import { ContributorsInput } from "./comparisons.ts";
import { CommandId, Instant, Version } from "./values.ts";

export const AnalysisId = Schema.String.check(Schema.isUUID()).pipe(Schema.brand("AnalysisId"));
export const AnalysisName = Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(100));
export const SavedAnalysis = Schema.Struct({
  id: AnalysisId,
  name: AnalysisName,
  definition: ContributorsInput,
  version: Version,
  createdAt: Instant,
  updatedAt: Instant,
});
export type SavedAnalysis = typeof SavedAnalysis.Type;
export const GetAnalysis = Schema.Struct({ id: AnalysisId });
export const SaveAnalysis = Schema.Struct({
  commandId: CommandId,
  name: AnalysisName,
  definition: ContributorsInput,
});
export const RenameAnalysis = Schema.Struct({
  commandId: CommandId,
  id: AnalysisId,
  expectedVersion: Version,
  name: AnalysisName,
});
export const DeleteAnalysis = Schema.Struct({
  commandId: CommandId,
  id: AnalysisId,
  expectedVersion: Version,
});
