import { Schema } from "effect";

import {
  CategoryId,
  CategoryTree,
  Channel,
  CounterpartyId,
  CounterpartyKind,
  CounterpartyRole,
} from "./interpretation.ts";
import { ModelProvider } from "./models.ts";
import { AccountKind, CommandId, Instant, Money, Version } from "./values.ts";

export const EnrichmentRunId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("EnrichmentRunId"),
);
export const Confidence = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1),
);

export const EnrichmentSettings = Schema.Struct({
  enabled: Schema.Boolean,
  warning: Schema.NullOr(Money),
  autoApplyConfidence: Confidence,
  version: Version,
  provider: ModelProvider,
});
export const UpdateEnrichmentSettings = Schema.Struct({
  commandId: CommandId,
  enabled: Schema.Boolean,
  warning: Schema.NullOr(Money),
  autoApplyConfidence: Confidence,
  expectedVersion: Version,
});

export const EnrichmentRun = Schema.Struct({
  id: EnrichmentRunId,
  status: Schema.Literals(["pending", "running", "completed", "failed"]),
  model: Schema.String,
  createdAt: Instant,
  requested: Schema.Int,
  resolved: Schema.Int,
  failed: Schema.Int,
  failure: Schema.NullOr(Schema.String),
});
export const EnrichmentRuns = Schema.Array(EnrichmentRun);
export const RequestEnrichment = Schema.Struct({ commandId: CommandId });
export const EnrichmentInput = Schema.Struct({ runId: EnrichmentRunId });

// What the model sees for one alias: descriptor text only, never amounts, dates,
// balances, account numbers, card suffixes, PayIDs, or references.
export const EnrichmentAlias = Schema.Struct({
  aliasKey: Schema.String,
  samples: Schema.Array(Schema.String),
  channels: Schema.Array(Channel),
  directions: Schema.Array(Schema.Literals(["out", "in"])),
  accountKinds: Schema.Array(AccountKind),
  transactionCount: Schema.Int,
});
// A category's slug, or its ID when you created it and it has no slug.
export const EnrichmentCategory = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  parentKey: Schema.NullOr(Schema.String),
  tree: CategoryTree,
});
export const EnrichmentExample = Schema.Struct({
  samples: Schema.Array(Schema.String),
  name: Schema.String,
  kind: CounterpartyKind,
  categoryKey: Schema.NullOr(Schema.String),
  defaultRole: Schema.NullOr(CounterpartyRole),
});
export const EnrichmentBatch = Schema.Struct({
  commandId: CommandId,
  runId: EnrichmentRunId,
  aliases: Schema.Array(EnrichmentAlias),
  categories: Schema.Array(EnrichmentCategory),
  counterparties: Schema.Array(
    Schema.Struct({ id: CounterpartyId, name: Schema.String, kind: CounterpartyKind }),
  ),
  examples: Schema.Array(EnrichmentExample),
  provider: ModelProvider,
});

export const EnrichmentResult = Schema.Struct({
  aliasKey: Schema.String,
  existingCounterpartyId: Schema.NullOr(Schema.String),
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  kind: CounterpartyKind,
  brand: Schema.NullOr(Schema.String),
  categoryKey: Schema.NullOr(Schema.String),
  defaultRole: Schema.NullOr(CounterpartyRole),
  confidence: Confidence,
  reason: Schema.String.check(Schema.isMaxLength(300)),
  proposedSubcategory: Schema.NullOr(
    Schema.Struct({ parentKey: Schema.String, name: Schema.String }),
  ),
});
export type EnrichmentResult = typeof EnrichmentResult.Type;
export const EnrichmentOutput = Schema.Struct({ results: Schema.Array(EnrichmentResult) });

export const EnrichmentReport = Schema.Struct({
  status: Schema.Literals(["success", "failed"]),
  results: Schema.Array(EnrichmentResult),
  inputTokens: Schema.NullOr(Schema.BigIntFromString),
  outputTokens: Schema.NullOr(Schema.BigIntFromString),
  cost: Schema.NullOr(Money),
  failure: Schema.NullOr(Schema.String),
});
export const CompleteEnrichmentBatch = Schema.Struct({
  commandId: CommandId,
  runId: EnrichmentRunId,
  aliasKeys: Schema.Array(Schema.String),
  report: EnrichmentReport,
});
export const FailEnrichment = Schema.Struct({
  runId: EnrichmentRunId,
  message: Schema.String,
});

export const CategoryProposal = Schema.Struct({
  id: Schema.String,
  parentId: Schema.String,
  parentName: Schema.String,
  name: Schema.String,
  reason: Schema.String,
  aliasKeys: Schema.Array(Schema.String),
  // Counterparties the model placed in the parent or one of its subcategories that
  // would move to the new subcategory. Counterparties you set are never moved.
  counterparties: Schema.Array(Schema.Struct({ id: CounterpartyId, name: Schema.String })),
  createdAt: Instant,
});
export const CategoryProposals = Schema.Array(CategoryProposal);
export const ResolveCategoryProposal = Schema.Struct({
  commandId: CommandId,
  proposalId: Schema.String,
  decision: Schema.Literals(["accept", "dismiss"]),
});
export const CategoryProposalOutcome = Schema.Struct({
  categoryId: Schema.NullOr(CategoryId),
  moved: Schema.Int,
});
