import { Schema, Struct } from "effect";

import { CommandId, Instant, Money, Version } from "./values.ts";

// The Workers AI models that identify counterparties and answer your questions.
export const enrichmentModel = "@cf/zai-org/glm-5.3-flash";
export const analystModel = "@cf/zai-org/glm-5.3-flash";

// What a model call was for, in the order Settings lists them. An evaluation checks the
// identification model against your answers, and a briefing is the analyst's summary of
// a month.
export const ModelTask = Schema.Literals(["enrichment", "evaluation", "analyst", "briefing"]);
export type ModelTask = typeof ModelTask.Type;

export const Confidence = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
);

export const ModelProvider = Schema.Struct({
  name: Schema.String,
  model: Schema.String,
  inputMicrousdPerMillion: Schema.BigIntFromString,
  cachedInputMicrousdPerMillion: Schema.BigIntFromString,
  outputMicrousdPerMillion: Schema.BigIntFromString,
});
export type ModelProvider = typeof ModelProvider.Type;

// Identification and the analyst each have a switch. The warning, in US dollars, covers
// the recorded usage of every task.
export const ModelSettings = Schema.Struct({
  enrichment: Schema.Struct({
    enabled: Schema.Boolean,
    autoApplyConfidence: Confidence,
    provider: ModelProvider,
  }),
  analyst: Schema.Struct({ enabled: Schema.Boolean, provider: ModelProvider }),
  warning: Schema.NullOr(Money),
  version: Version,
});
export type ModelSettings = typeof ModelSettings.Type;
export const UpdateModelSettings = Schema.Struct({
  commandId: CommandId,
  enrichment: Schema.Struct(Struct.omit(ModelSettings.fields.enrichment.fields, ["provider"])),
  analyst: Schema.Struct(Struct.omit(ModelSettings.fields.analyst.fields, ["provider"])),
  warning: ModelSettings.fields.warning,
  expectedVersion: Version,
});

export const ModelAllowanceInput = Schema.Struct({ task: ModelTask });
// Whether a task may call its model now: its switch is on and recorded usage is under
// the warning. A refusal says what to change in Settings.
export const ModelAllowance = Schema.Union([
  Schema.Struct({ allowed: Schema.Literal(true), provider: ModelProvider }),
  Schema.Struct({ allowed: Schema.Literal(false), message: Schema.String }),
]);

// Tokens and cost stay null when the provider did not report them, never zero.
export const RecordModelUsage = Schema.Struct({
  commandId: CommandId,
  task: ModelTask,
  model: Schema.String,
  inputTokens: Schema.NullOr(Schema.BigIntFromString),
  outputTokens: Schema.NullOr(Schema.BigIntFromString),
  cost: Schema.NullOr(Money),
  status: Schema.Literals(["success", "failed"]),
});
// Usage recorded by tasks since retired keeps their names and still counts toward the
// warning.
export const ModelUsageEntry = Schema.Struct({
  id: Schema.String,
  task: Schema.String,
  model: Schema.String,
  occurredAt: Instant,
  inputTokens: RecordModelUsage.fields.inputTokens,
  outputTokens: RecordModelUsage.fields.outputTokens,
  cost: RecordModelUsage.fields.cost,
  status: RecordModelUsage.fields.status,
});
// Totals over the calls that reported each figure. A token total is null when no call
// reported it, `costs` has no entry until a call reports a cost, and `unknownUsage`
// counts the calls whose report left something out.
const UsageTotals = Schema.Struct({
  calls: Schema.Int,
  inputTokens: RecordModelUsage.fields.inputTokens,
  outputTokens: RecordModelUsage.fields.outputTokens,
  unknownUsage: Schema.Int,
  costs: Schema.Array(Money),
});
export const ModelUsage = Schema.Struct({
  ...UsageTotals.fields,
  tasks: Schema.Array(Schema.Struct({ task: ModelUsageEntry.fields.task, ...UsageTotals.fields })),
  recent: Schema.Array(ModelUsageEntry),
});
