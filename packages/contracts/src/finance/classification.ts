import { Schema } from "effect";

import { ExpectedEventVersion } from "./corrections.ts";
import { ReferenceData } from "./events.ts";
import { CategoryId, EventId, FinancialRole } from "./interpretation.ts";
import { AccountKind, CommandId, Instant, Money, Version } from "./values.ts";
export const ClassificationRunId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("ClassificationRunId"),
);
export const ClassificationProvider = Schema.Struct({
  name: Schema.String,
  model: Schema.String,
  inputMicrousdPerMillion: Schema.BigIntFromString,
  outputMicrousdPerMillion: Schema.BigIntFromString,
});
export const ClassificationSettings = Schema.Struct({
  enabled: Schema.Boolean,
  warning: Schema.NullOr(Money),
  version: Version,
  provider: Schema.NullOr(ClassificationProvider),
});
export const UpdateClassificationSettings = Schema.Struct({
  commandId: CommandId,
  enabled: Schema.Boolean,
  warning: Schema.NullOr(Money),
  expectedVersion: Version,
});
export const CategorySuggestion = Schema.Struct({
  eventVersion: Version,
  categoryId: Schema.NullOr(CategoryId),
  reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
  model: Schema.String,
  createdAt: Instant,
});
export const SuggestionRow = Schema.Struct({
  eventId: EventId,
  description: Schema.String,
  suggestion: CategorySuggestion,
});
export const SuggestionList = Schema.Array(SuggestionRow);
export const SuggestCategories = Schema.Struct({
  commandId: CommandId,
  eventIds: Schema.Union([Schema.Literal("all"), Schema.NonEmptyArray(EventId)]),
});
export const AcceptSuggestions = Schema.Struct({
  commandId: CommandId,
  expectedVersions: Schema.NonEmptyArray(ExpectedEventVersion),
});
export const AcceptanceSummary = Schema.Struct({ accepted: Schema.Int, skipped: Schema.Int });
export const ClassificationRun = Schema.Struct({
  id: ClassificationRunId,
  status: Schema.Literals(["pending", "running", "completed", "failed"]),
  model: Schema.String,
  createdAt: Instant,
  requested: Schema.Int,
  processed: Schema.Int,
  failure: Schema.NullOr(Schema.String),
});
export const ClassificationRuns = Schema.Array(ClassificationRun);
export const ClassificationInput = Schema.Struct({ runId: ClassificationRunId });
export const ClassificationItem = Schema.Struct({
  eventId: EventId,
  eventVersion: Version,
  description: Schema.String.check(Schema.isMaxLength(1000)),
  role: FinancialRole,
  accountKind: AccountKind,
  merchant: Schema.NullOr(Schema.String),
});
export const ClassificationBatch = Schema.Struct({
  commandId: CommandId,
  runId: ClassificationRunId,
  items: Schema.Array(ClassificationItem),
  categories: ReferenceData.fields.categories,
  provider: ClassificationProvider,
});
export const CategoryResult = Schema.Struct({
  eventId: EventId,
  categoryId: Schema.NullOr(CategoryId),
  reason: CategorySuggestion.fields.reason,
});
export const ClassificationOutput = Schema.Struct({ results: Schema.Array(CategoryResult) });
export const ClassificationReport = Schema.Struct({
  status: Schema.Literals(["success", "failed"]),
  results: Schema.Array(CategoryResult),
  inputTokens: Schema.NullOr(Schema.BigIntFromString),
  outputTokens: Schema.NullOr(Schema.BigIntFromString),
  cost: Schema.NullOr(Money),
  failure: Schema.NullOr(Schema.String),
});
export const CompleteClassificationBatch = Schema.Struct({
  commandId: CommandId,
  runId: ClassificationRunId,
  expectedVersions: Schema.Array(ExpectedEventVersion),
  report: ClassificationReport,
});
export const FailClassification = Schema.Struct({
  runId: ClassificationRunId,
  message: Schema.String,
});
